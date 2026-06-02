import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PYTHON_COMMAND_PATTERN =
	/(?:^|[;&|()\n\r`])\s*(?:(?:env|command|exec|time|nice|nohup)\s+(?:-[^\s]+\s+)*)*(?:uv\s+run\s+)?(?:(?:\.{1,2}\/|\/)(?:[^\s;&|()]+\/)*)?(?:python(?:\d+(?:\.\d+)?)?|py)(?=$|\s|[;&|)])/i;

const PYTHON_BLOCK_REASON =
	"Python is disabled in bash commands. Use read/edit/write or shell-native tools instead.";

const isPythonCommand = (command: string): boolean =>
	PYTHON_COMMAND_PATTERN.test(command);

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String(event.input.command ?? "");
		if (!isPythonCommand(command)) return undefined;

		if (ctx.hasUI) {
			ctx.ui.notify("Blocked Python inside bash tool call", "warning");
		}

		return {
			block: true,
			reason: PYTHON_BLOCK_REASON,
		};
	});

	pi.on("user_bash", (event, ctx) => {
		if (!isPythonCommand(event.command)) return undefined;

		if (ctx.hasUI) {
			ctx.ui.notify("Blocked Python user bash command", "warning");
		}

		return {
			result: {
				output: PYTHON_BLOCK_REASON,
				exitCode: 126,
				cancelled: false,
				truncated: false,
			},
		};
	});
}
