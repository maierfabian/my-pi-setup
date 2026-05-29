import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const OptionSchema = Type.Object({
	value: Type.Optional(Type.String({ description: "Stable value for this option. Defaults to label." })),
	label: Type.String({ description: "Short option label shown to the user." }),
	description: Type.Optional(Type.String({ description: "Detailed explanation shown under the option." })),
});

const QuestionSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "Stable question id. Defaults to q1, q2, ..." })),
	label: Type.Optional(Type.String({ description: "Short tab/summary label. Defaults to Q1, Q2, ..." })),
	prompt: Type.String({ description: "Question to ask the user." }),
	mode: Type.Optional(StringEnum(["single", "multiple"] as const)),
	options: Type.Array(OptionSchema, { description: "Options the user can select." }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow a custom answer. Defaults to true." })),
	allowNote: Type.Optional(Type.Boolean({ description: "Allow an additional user note. Defaults to true." })),
	minSelections: Type.Optional(Type.Number({ description: "Minimum selections required for multiple-choice questions." })),
	maxSelections: Type.Optional(Type.Number({ description: "Maximum selections allowed for multiple-choice questions." })),
});

const AskUserParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "One or more questions to ask." }),
});

type Mode = "single" | "multiple";

interface NormalizedOption {
	value: string;
	label: string;
	description?: string;
	custom?: boolean;
}

interface NormalizedQuestion {
	id: string;
	label: string;
	prompt: string;
	mode: Mode;
	options: NormalizedOption[];
	allowOther: boolean;
	allowNote: boolean;
	minSelections: number;
	maxSelections?: number;
}

interface QuestionAnswer {
	id: string;
	prompt: string;
	mode: Mode;
	selected: NormalizedOption[];
	note?: string;
}

interface AskUserDetails {
	questions: NormalizedQuestion[];
	answers: QuestionAnswer[];
	cancelled: boolean;
}

interface AnswerState {
	selectedKeys: Set<string>;
	customOptions: NormalizedOption[];
	note: string;
}

function normalizeQuestions(input: Array<{
	id?: string;
	label?: string;
	prompt: string;
	mode?: Mode;
	options: Array<{ value?: string; label: string; description?: string }>;
	allowOther?: boolean;
	allowNote?: boolean;
	minSelections?: number;
	maxSelections?: number;
}>): NormalizedQuestion[] {
	return input.map((question, questionIndex) => {
		const mode = question.mode ?? "single";
		const minSelections = Math.max(0, Math.floor(question.minSelections ?? (mode === "multiple" ? 1 : 1)));
		const maxSelections =
			question.maxSelections === undefined ? undefined : Math.max(1, Math.floor(question.maxSelections));

		return {
			id: question.id?.trim() || `q${questionIndex + 1}`,
			label: question.label?.trim() || `Q${questionIndex + 1}`,
			prompt: question.prompt,
			mode,
			options: question.options.map((option) => ({
				value: option.value?.trim() || option.label,
				label: option.label,
				description: option.description,
			})),
			allowOther: question.allowOther !== false,
			allowNote: question.allowNote !== false,
			minSelections,
			maxSelections,
		};
	});
}

function optionKey(index: number): string {
	return `option:${index}`;
}

function customKey(index: number): string {
	return `custom:${index}`;
}

function getSelectedOptions(question: NormalizedQuestion, state: AnswerState): NormalizedOption[] {
	const selected: NormalizedOption[] = [];
	for (let i = 0; i < question.options.length; i++) {
		if (state.selectedKeys.has(optionKey(i))) selected.push(question.options[i]);
	}
	for (let i = 0; i < state.customOptions.length; i++) {
		if (state.selectedKeys.has(customKey(i))) selected.push(state.customOptions[i]);
	}
	return selected;
}

function buildAnswers(questions: NormalizedQuestion[], states: Map<string, AnswerState>): QuestionAnswer[] {
	return questions.map((question) => {
		const state = states.get(question.id) ?? { selectedKeys: new Set<string>(), customOptions: [], note: "" };
		const note = state.note.trim();
		return {
			id: question.id,
			prompt: question.prompt,
			mode: question.mode,
			selected: getSelectedOptions(question, state),
			...(note ? { note } : {}),
		};
	});
}

function validateAnswer(question: NormalizedQuestion, state: AnswerState): string | undefined {
	const count = state.selectedKeys.size;
	if (count < question.minSelections) {
		return `Select at least ${question.minSelections} option${question.minSelections === 1 ? "" : "s"}.`;
	}
	if (question.maxSelections !== undefined && count > question.maxSelections) {
		return `Select at most ${question.maxSelections} option${question.maxSelections === 1 ? "" : "s"}.`;
	}
	return undefined;
}

function allValid(questions: NormalizedQuestion[], states: Map<string, AnswerState>): boolean {
	return questions.every((question) => {
		const state = states.get(question.id);
		return state !== undefined && validateAnswer(question, state) === undefined;
	});
}

function markdownList(items: NormalizedOption[]): string {
	if (items.length === 0) return "- _No selection_";
	return items
		.map((item) => {
			const description = item.description ? ` — ${item.description}` : "";
			const custom = item.custom ? " _(custom)_" : "";
			return `- **${item.label}**${custom}${description}`;
		})
		.join("\n");
}

function buildMarkdown(details: AskUserDetails): string {
	if (details.cancelled) return "## User answer\n\nUser cancelled the question.";

	const sections = details.answers.map((answer, index) => {
		const title = details.answers.length === 1 ? "## User answer" : `## User answer ${index + 1}: ${answer.id}`;
		const note = answer.note ? `\n\n### User note\n\n${answer.note}` : "";
		return `${title}\n\n**Question:** ${answer.prompt}\n\n### Selected option${answer.selected.length === 1 ? "" : "s"}\n\n${markdownList(answer.selected)}${note}`;
	});

	return sections.join("\n\n");
}

export default function askUser(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user one or more interactive questions. Supports single-select, multi-select, detailed option descriptions, custom answers, and user notes.",
		promptSnippet:
			"Ask the user a single-choice or multiple-choice question with optional custom answer and note.",
		promptGuidelines: [
			"Use ask_user when progress depends on a user preference, clarification, or confirmation instead of guessing.",
			"Prefer 2-4 well-described ask_user options and include an Other/custom path when the user's answer may not fit.",
		],
		parameters: AskUserParams,
		prepareArguments(args) {
			if (!args || typeof args !== "object") return args;
			const input = args as {
				question?: unknown;
				options?: unknown;
				questions?: unknown;
				mode?: unknown;
				allowOther?: unknown;
				allowNote?: unknown;
			};
			if (Array.isArray(input.questions)) return args;
			if (typeof input.question === "string" && Array.isArray(input.options)) {
				return {
					questions: [
						{
							prompt: input.question,
							options: input.options,
							mode: input.mode,
							allowOther: input.allowOther,
							allowNote: input.allowNote,
						},
					],
				};
			}
			return args;
		},

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions);
			if (!ctx.hasUI) {
				const details: AskUserDetails = { questions, answers: [], cancelled: true };
				return { content: [{ type: "text", text: buildMarkdown(details) }], details };
			}
			if (questions.length === 0) {
				const details: AskUserDetails = { questions, answers: [], cancelled: true };
				return { content: [{ type: "text", text: "## User answer\n\nNo questions were provided." }], details };
			}
			if (questions.some((question) => question.options.length === 0 && !question.allowOther)) {
				const details: AskUserDetails = { questions, answers: [], cancelled: true };
				return {
					content: [{ type: "text", text: "## User answer\n\nAt least one question had no options and no custom answer path." }],
					details,
				};
			}

			const result = await ctx.ui.custom<AskUserDetails>((tui, theme, _keybindings, done) => {
				let currentQuestionIndex = 0;
				let cursorIndex = 0;
				let inputMode: "other" | "note" | null = null;
				let cachedLines: string[] | undefined;
				const states = new Map<string, AnswerState>();

				for (const question of questions) {
					states.set(question.id, { selectedKeys: new Set<string>(), customOptions: [], note: "" });
				}

				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("dim", text),
						noMatch: (text) => theme.fg("warning", text),
					},
				};
				const editor = new Editor(tui, editorTheme);

				function stateFor(question: NormalizedQuestion): AnswerState {
					const state = states.get(question.id);
					if (state) return state;
					const next = { selectedKeys: new Set<string>(), customOptions: [], note: "" };
					states.set(question.id, next);
					return next;
				}

				function currentQuestion(): NormalizedQuestion {
					return questions[currentQuestionIndex];
				}

				function optionCount(question: NormalizedQuestion): number {
					const state = stateFor(question);
					return question.options.length + state.customOptions.length + (question.allowOther ? 1 : 0);
				}

				function refresh(): void {
					cachedLines = undefined;
					tui.requestRender();
				}

				function finish(cancelled: boolean): void {
					done({ questions, answers: cancelled ? [] : buildAnswers(questions, states), cancelled });
				}

				function moveQuestion(delta: number): void {
					currentQuestionIndex = (currentQuestionIndex + delta + questions.length) % questions.length;
					cursorIndex = Math.min(cursorIndex, Math.max(0, optionCount(currentQuestion()) - 1));
					refresh();
				}

				function toggleAt(question: NormalizedQuestion, index: number): void {
					const state = stateFor(question);
					const builtInCount = question.options.length;
					const customCount = state.customOptions.length;

					if (question.allowOther && index === builtInCount + customCount) {
						inputMode = "other";
						editor.setText("");
						refresh();
						return;
					}

					const key = index < builtInCount ? optionKey(index) : customKey(index - builtInCount);
					if (question.mode === "single") {
						state.selectedKeys.clear();
						state.selectedKeys.add(key);
						if (questions.length === 1) {
							if (question.allowNote) refresh();
							else finish(false);
							return;
						}
						refresh();
						return;
					}

					if (state.selectedKeys.has(key)) {
						state.selectedKeys.delete(key);
						refresh();
						return;
					}

					if (question.maxSelections !== undefined && state.selectedKeys.size >= question.maxSelections) {
						ctx.ui.notify(`Maximum ${question.maxSelections} selection${question.maxSelections === 1 ? "" : "s"}.`, "warning");
						return;
					}
					state.selectedKeys.add(key);
					refresh();
				}

				editor.onSubmit = (value) => {
					const question = currentQuestion();
					const state = stateFor(question);
					const trimmed = value.trim();
					if (inputMode === "note") {
						state.note = trimmed;
						inputMode = null;
						editor.setText("");
						refresh();
						return;
					}
					if (inputMode === "other") {
						if (!trimmed) {
							inputMode = null;
							editor.setText("");
							refresh();
							return;
						}
						const customIndex = state.customOptions.length;
						state.customOptions.push({ value: trimmed, label: trimmed, custom: true });
						if (question.mode === "single") state.selectedKeys.clear();
						state.selectedKeys.add(customKey(customIndex));
						inputMode = null;
						editor.setText("");
						refresh();
					}
				};

				function submitCurrentOrAll(): void {
					const question = currentQuestion();
					const error = validateAnswer(question, stateFor(question));
					if (error) {
						ctx.ui.notify(error, "warning");
						return;
					}
					if (questions.length === 1 || allValid(questions, states)) {
						finish(false);
						return;
					}
					const nextInvalidIndex = questions.findIndex((q) => validateAnswer(q, stateFor(q)) !== undefined);
					currentQuestionIndex = nextInvalidIndex >= 0 ? nextInvalidIndex : currentQuestionIndex;
					cursorIndex = 0;
					refresh();
				}

				function handleNumberShortcut(data: string): boolean {
					if (!/^[1-9]$/.test(data)) return false;
					const question = currentQuestion();
					const index = Number(data) - 1;
					if (index >= optionCount(question)) return false;
					cursorIndex = index;
					toggleAt(question, index);
					return true;
				}

				function handleInput(data: string): void {
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							inputMode = null;
							editor.setText("");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					if (handleNumberShortcut(data)) return;

					if (questions.length > 1 && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) {
						moveQuestion(1);
						return;
					}
					if (questions.length > 1 && (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left))) {
						moveQuestion(-1);
						return;
					}

					const question = currentQuestion();
					const count = optionCount(question);

					if (matchesKey(data, Key.up)) {
						cursorIndex = Math.max(0, cursorIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						cursorIndex = Math.min(Math.max(0, count - 1), cursorIndex + 1);
						refresh();
						return;
					}
					if (data.toLowerCase() === "n" && question.allowNote) {
						inputMode = "note";
						editor.setText(stateFor(question).note);
						refresh();
						return;
					}
					if (data.toLowerCase() === "o" && question.allowOther) {
						inputMode = "other";
						editor.setText("");
						refresh();
						return;
					}
					if (matchesKey(data, Key.space)) {
						toggleAt(question, cursorIndex);
						return;
					}
					if (matchesKey(data, Key.enter)) {
						if (question.mode === "single" && stateFor(question).selectedKeys.size === 0) {
							toggleAt(question, cursorIndex);
							return;
						}
						submitCurrentOrAll();
						return;
					}
					if (matchesKey(data, Key.escape)) finish(true);
				}

				function renderOptionLine(question: NormalizedQuestion, state: AnswerState, index: number, option: NormalizedOption, width: number): string[] {
					const selected = state.selectedKeys.has(index < question.options.length ? optionKey(index) : customKey(index - question.options.length));
					const active = index === cursorIndex;
					const marker = question.mode === "multiple" ? (selected ? "[x]" : "[ ]") : selected ? "●" : "○";
					const prefix = active ? theme.fg("accent", "> ") : "  ";
					const labelColor = active ? "accent" : selected ? "success" : "text";
					const custom = option.custom ? " (custom)" : "";
					const first = prefix + theme.fg(labelColor, `${marker} ${index + 1}. ${option.label}${custom}`);
					const lines = [truncateToWidth(first, width)];
					if (option.description) {
						for (const wrapped of wrapTextWithAnsi(theme.fg("muted", option.description), Math.max(1, width - 7))) {
							lines.push(truncateToWidth(`       ${wrapped}`, width));
						}
					}
					return lines;
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;
					const lines: string[] = [];
					const add = (text: string) => lines.push(truncateToWidth(text, width));
					const question = currentQuestion();
					const state = stateFor(question);
					const selected = getSelectedOptions(question, state);

					add(theme.fg("accent", "─".repeat(width)));
					if (questions.length > 1) {
						const tabs = questions
							.map((q, index) => {
								const valid = validateAnswer(q, stateFor(q)) === undefined;
								const body = ` ${valid ? "■" : "□"} ${q.label} `;
								if (index === currentQuestionIndex) return theme.bg("selectedBg", theme.fg("text", body));
								return theme.fg(valid ? "success" : "muted", body);
							})
							.join(" ");
						add(` ${tabs}`);
						lines.push("");
					}

					add(theme.fg("text", ` ${question.prompt}`));
					lines.push("");
					for (let i = 0; i < question.options.length; i++) {
						lines.push(...renderOptionLine(question, state, i, question.options[i], width));
					}
					for (let i = 0; i < state.customOptions.length; i++) {
						lines.push(...renderOptionLine(question, state, question.options.length + i, state.customOptions[i], width));
					}
					if (question.allowOther) {
						const otherIndex = question.options.length + state.customOptions.length;
						const active = otherIndex === cursorIndex;
						add(`${active ? theme.fg("accent", "> ") : "  "}${theme.fg(active ? "accent" : "muted", `+ ${otherIndex + 1}. Other / custom answer`)}`);
					}

					if (state.note.trim()) {
						lines.push("");
						add(theme.fg("muted", ` Note: ${state.note.trim()}`));
					}

					const validation = validateAnswer(question, state);
					if (validation) {
						lines.push("");
						add(theme.fg("warning", ` ${validation}`));
					}

					if (inputMode) {
						lines.push("");
						add(theme.fg("muted", inputMode === "note" ? " Note:" : " Custom answer:"));
						for (const line of editor.render(Math.max(1, width - 2))) add(` ${line}`);
					}

					lines.push("");
					const selectedCount = selected.length;
					const questionNav = questions.length > 1 ? " • Tab/←→ question" : "";
					if (inputMode) add(theme.fg("dim", " Enter submit text • Esc back"));
					else {
						add(
							theme.fg(
								"dim",
								` ↑↓ move • 1-9 quick • Space toggle • n note • o other • Enter submit${questionNav} • Esc cancel`,
							),
						);
						add(theme.fg("dim", ` Selected: ${selectedCount}${allValid(questions, states) ? " • all valid" : ""}`));
					}
					add(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			const markdown = buildMarkdown(result);
			return { content: [{ type: "text", text: markdown }], details: result };
		},

		renderCall(args, theme) {
			const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
			const questionCount = rawQuestions.length;
			const label = questionCount === 1 ? rawQuestions[0]?.prompt : `${questionCount} questions`;
			return new Text(theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", String(label ?? "")), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as AskUserDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			const lines = details.answers.map((answer) => {
				const selected = answer.selected.map((option) => option.label).join(", ") || "No selection";
				const note = answer.note ? theme.fg("dim", ` + note`) : "";
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${selected}${note}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
