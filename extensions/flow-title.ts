import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);
const REFRESH_MS = 2_000;

type GitInfo = {
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
};

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: 2_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trimEnd();
}

function folderName(cwd: string) {
  return path.basename(cwd) || cwd;
}

function parsePorcelainV2(output: string): Omit<GitInfo, "branch"> {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let ahead = 0;
  let behind = 0;

  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith("? ")) {
      untracked += 1;
      continue;
    }
    if (line[0] === "1" || line[0] === "2" || line[0] === "u") {
      const xy = line.slice(2, 4);
      if (xy[0] && xy[0] !== ".") staged += 1;
      if (xy[1] && xy[1] !== ".") unstaged += 1;
    }
  }

  return { staged, unstaged, untracked, ahead, behind };
}

async function readGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    const [branchOutput, statusOutput] = await Promise.all([
      git(cwd, ["branch", "--show-current"]),
      git(cwd, ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]),
    ]);

    let branch = branchOutput;
    if (!branch) {
      const head = await git(cwd, ["rev-parse", "--short", "HEAD"]);
      branch = head ? `detached@${head}` : "detached";
    }

    return { branch, ...parsePorcelainV2(statusOutput) };
  } catch {
    return null;
  }
}

const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
];

function centerLine(line: string, width: number) {
  const clipped = truncateToWidth(line, width, "");
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function renderHeaderLines(ctx: ExtensionContext, theme: Theme, gitInfo: GitInfo | null, width: number) {
  const logo = TITLE_LINES.map((line) => centerLine(theme.fg("accent", line), width));
  const meta: string[] = [theme.fg("text", folderName(ctx.cwd))];

  if (gitInfo) {
    meta.push(theme.fg("dim", "") + " " + theme.fg("muted", gitInfo.branch));

    const gitBits: string[] = [];
    if (gitInfo.ahead) gitBits.push(theme.fg("success", `↑${gitInfo.ahead}`));
    if (gitInfo.behind) gitBits.push(theme.fg("warning", `↓${gitInfo.behind}`));
    if (gitInfo.staged) gitBits.push(theme.fg("success", `+${gitInfo.staged}`));
    if (gitInfo.unstaged) gitBits.push(theme.fg("warning", `~${gitInfo.unstaged}`));
    if (gitInfo.untracked) gitBits.push(theme.fg("muted", `?${gitInfo.untracked}`));
    if (gitBits.length > 0) meta.push(gitBits.join(" "));
  }

  const context = ctx.getContextUsage();
  const percent = context?.percent;
  if (typeof percent === "number") {
    const color = percent > 90 ? "error" : percent > 70 ? "warning" : "dim";
    meta.push(theme.fg(color, `ctx ${Math.round(percent)}%`));
  }

  return [
    "",
    ...logo,
    centerLine(meta.join(theme.fg("dim", "  ·  ")), width),
    "",
  ];
}

export default function (pi: ExtensionAPI) {
  let interval: NodeJS.Timeout | undefined;
  let requestRender: (() => void) | undefined;
  let gitInfo: GitInfo | null = null;

  async function refresh(ctx: ExtensionContext) {
    gitInfo = await readGitInfo(ctx.cwd);
    requestRender?.();
  }

  function installHeader(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number) {
          return renderHeaderLines(ctx, theme, gitInfo, width);
        },
        invalidate() {},
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    if (interval) clearInterval(interval);
    installHeader(ctx);
    await refresh(ctx);
    interval = setInterval(() => void refresh(ctx), REFRESH_MS);
  });

  pi.on("input", async (_event, ctx) => {
    await refresh(ctx);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    await refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (interval) clearInterval(interval);
    interval = undefined;
    requestRender = undefined;
    if (ctx.hasUI) ctx.ui.setHeader(undefined);
  });

  pi.registerCommand("flow-title", {
    description: "Use the minimal project status header",
    handler: async (_args, ctx) => {
      installHeader(ctx);
      await refresh(ctx);
      ctx.ui.notify("Minimal header enabled", "info");
    },
  });

  pi.registerCommand("flow-title-builtin", {
    description: "Restore pi's built-in header for this session",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
