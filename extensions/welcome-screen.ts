import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type WelcomeStats = {
	extensions: number;
	skills: number;
	tools: number;
};

const CONTENT_HEIGHT = 17;

const rgb = (hex: string, text: string) => {
	const clean = hex.replace("#", "");
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	return `\u001b[38;2;${r};${g};${b}m${text}\u001b[39m`;
};

const bold = (text: string) => `\u001b[1m${text}\u001b[22m`;

const fitAnsi = (text: string, width: number) => {
	if (width <= 0) return "";
	const current = visibleWidth(text);
	if (current > width) return truncateToWidth(text, width, "");
	return text + " ".repeat(width - current);
};

const centerAnsi = (text: string, width: number) => {
	const current = visibleWidth(text);
	if (current >= width) return truncateToWidth(text, width, "");
	const left = Math.floor((width - current) / 2);
	return " ".repeat(left) + text + " ".repeat(width - current - left);
};

const countExtensionEntrypoints = (cwd: string) => {
	const dirs = [join(homedir(), ".pi", "agent", "extensions"), join(cwd, ".pi", "extensions")];
	const seen = new Set<string>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".")) continue;
			const fullPath = join(dir, entry);
			let stat;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (stat.isFile() && entry.endsWith(".ts")) {
				seen.add(fullPath);
			} else if (stat.isDirectory() && (existsSync(join(fullPath, "index.ts")) || existsSync(join(fullPath, "package.json")))) {
				seen.add(fullPath);
			}
		}
	}

	return seen.size;
};

const getStats = (pi: ExtensionAPI, cwd: string): WelcomeStats => {
	let skills = 0;
	let extensionCommandSources = 0;
	try {
		const commands = pi.getCommands();
		skills = commands.filter((command) => command.source === "skill").length;
		extensionCommandSources = new Set(
			commands
				.filter((command) => command.source === "extension")
				.map((command) => command.sourceInfo?.path ?? command.name),
		).size;
	} catch {
		// Runtime may be unavailable in non-interactive startup paths.
	}

	let tools = 0;
	try {
		const activeTools = pi.getActiveTools();
		tools = activeTools.length || pi.getAllTools().length;
	} catch {
		// Keep a quiet fallback; this is decorative startup UI.
	}

	return {
		extensions: Math.max(countExtensionEntrypoints(cwd), extensionCommandSources),
		skills,
		tools,
	};
};

const PI_LOGO = [
	"██████╗  ██╗",
	"██╔══██╗ ██║",
	"██████╔╝ ██║",
	"██╔═══╝  ██║",
	"██║      ██║",
	"╚═╝      ╚═╝",
];

const renderLeftPanel = (theme: Theme, width: number) => {
	const lines = Array.from({ length: CONTENT_HEIGHT }, () => " ".repeat(width));
	const logoStart = Math.max(0, Math.floor((CONTENT_HEIGHT - PI_LOGO.length) / 2) - 1);

	PI_LOGO.forEach((line, index) => {
		lines[logoStart + index] = centerAnsi(theme.fg("accent", line), width);
	});

	lines[logoStart + PI_LOGO.length + 1] = centerAnsi(theme.fg("muted", "welcome to pi"), width);
	lines[logoStart + PI_LOGO.length + 3] = centerAnsi(theme.fg("dim", "Today we are canceling the bugs"), width);

	return lines.map((line) => fitAnsi(line, width));
};

const renderRightPanel = (theme: Theme, width: number, stats: WelcomeStats) => {
	const blue = (text: string) => rgb("#3b82f6", text);
	const key = (text: string) => theme.fg("muted", text);
	const sep = theme.fg("dim", "─".repeat(Math.max(0, width)));

	const lines = [
		blue("~"),
		`${stats.extensions} extensions loaded`,
		`${stats.skills} skills loaded`,
		`${stats.tools} tools available`,
		sep,
		bold(blue("Quick Tips")),
		`${key("/")} for commands`,
		`${key("!")} to run bash`,
		`${key("Esc")} cancel/abort`,
		`${key("/quit")} quit pi`,
		sep,
		bold(blue("Navigation")),
		`${key("Shift+Tab")} cycle thinking level`,
		`${key("Ctrl+P")} cycle scoped model`,
		`${key("Esc Esc")} open /tree`,
		"",
		`${theme.fg("dim", "startup info")}`,
	];

	return lines.slice(0, CONTENT_HEIGHT).map((line) => fitAnsi(line, width));
};

const renderCompact = (theme: Theme, width: number, stats: WelcomeStats) => {
	const innerWidth = Math.max(20, Math.min(width - 4, 72));
	const border = (text: string) => theme.fg("dim", text);
	const title = `${theme.fg("accent", theme.bold("PI"))} ${theme.fg("text", "welcome")}`;
	const lines = [
		border(`╭${"─".repeat(innerWidth)}╮`),
		`${border("│")}${centerAnsi(title, innerWidth)}${border("│")}`,
		`${border("│")}${fitAnsi(`${stats.extensions} extensions · ${stats.skills} skills · ${stats.tools} tools`, innerWidth)}${border("│")}`,
		`${border("│")}${fitAnsi(`${theme.fg("muted", "/")} commands  ${theme.fg("muted", "!")} bash  ${theme.fg("muted", "Esc")} abort`, innerWidth)}${border("│")}`,
		border(`╰${"─".repeat(innerWidth)}╯`),
	];
	const indent = " ".repeat(Math.max(0, Math.floor((width - innerWidth - 2) / 2)));
	return ["", ...lines.map((line) => fitAnsi(indent + line, width)), ""];
};

class WelcomeHeader implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly stats: WelcomeStats,
	) {}

	render(width: number): string[] {
		if (width < 92) {
			return renderCompact(this.theme, width, this.stats);
		}

		const boxWidth = Math.max(80, Math.min(width - 4, 158));
		const rightWidth = boxWidth >= 118 ? 58 : Math.max(34, Math.floor(boxWidth * 0.38));
		const leftWidth = boxWidth - rightWidth - 3;
		const border = (text: string) => this.theme.fg("dim", text);
		const left = renderLeftPanel(this.theme, leftWidth);
		const right = renderRightPanel(this.theme, rightWidth, this.stats);
		const body = Array.from({ length: CONTENT_HEIGHT }, (_, index) => {
			return `${border("│")}${fitAnsi(left[index] ?? "", leftWidth)}${border("│")}${fitAnsi(right[index] ?? "", rightWidth)}${border("│")}`;
		});
		const lines = [
			border(`╭${"─".repeat(leftWidth)}┬${"─".repeat(rightWidth)}╮`),
			...body,
			border(`╰${"─".repeat(leftWidth)}┴${"─".repeat(rightWidth)}╯`),
		];
		const indent = " ".repeat(Math.max(0, Math.floor((width - boxWidth) / 2)));
		return ["", ...lines.map((line) => fitAnsi(indent + line, width)), ""];
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const stats = getStats(pi, ctx.cwd);
		ctx.ui.setHeader((_tui, theme) => new WelcomeHeader(theme, stats));
	});

	pi.registerCommand("builtin-header", {
		description: "Restore Pi's built-in startup header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
