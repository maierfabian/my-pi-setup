# Fabian's Pi Setup

Personal configuration for [Pi Coding Agent](https://pi.dev).

## Included

### Theme

- `themes/strave-dark.json` — custom Strave-branded dark theme.
  - Orange primary/accent: `#ff7700` / `#ff8800`
  - Dark surfaces: `#09090b`, `#18181b`, `#27272a`

`settings.json` selects this theme with:

```json
{
  "theme": "strave-dark"
}
```

### Extensions

- `copy-all.ts`
  - Adds `/copy-all` to copy all user and assistant messages in the current thread to the clipboard.

- `diff.ts`
  - Tracks files changed by the last agent run.
  - Adds `/diff` to list changed files or open one in Zed.

- `firecrawl-search.ts`
  - Adds agent tools:
    - `search` — web/news/image search via Firecrawl.
    - `scrape` — fetch a URL as clean markdown via Firecrawl.

- `flow-title.ts`
  - Adds `/flow-title` to enable a flowing gradient session header.
  - Adds `/flow-title-builtin` to restore Pi's built-in header.

- `git-status-widget.ts`
  - Shows current git branch and unstaged change count in the Pi UI.

- `lg.ts`
  - Adds `/lg` to summarize unstaged git changes with per-file +/- counts.

- `tps-tracker.ts`
  - Shows token-per-second generation status while the assistant responds.

- `update.ts`
  - Adds `/update` and `--update` to update Pi via the detected install method.

- `usage.ts`
  - Adds `/usage` to ask the agent for usage/cost summaries.

- `yeet.ts`
  - Adds `/yeet` to add, commit, push, and print the pushed repo/PR URL.

- `zsh-user-bash.ts`
  - Routes interactive user bash commands through zsh behavior.

- `ephemeral/`
  - Adds `/ephemeral`, an interactive picker for project-local ephemeral skills, prompts, extensions, and MCP servers.

- `pi-mcp/`
  - MCP adapter with:
    - `/mcp` for server status/tools/reconnect.
    - `/mcp-auth` for OAuth authentication.
    - `--mcp-config` for selecting an MCP config file.
    - `mcp` agent tool for proxying MCP tool/resource calls.

### Explicitly excluded

- `openai-codex-fast-mode.ts`
  - Not installed by request. This was the extension that forced `service_tier: "priority"` for Codex requests.

## Firecrawl API key

The search and scrape tools need a Firecrawl API key.

Set it in one of these places:

1. Shell environment:

```bash
export FIRECRAWL_API_KEY="fc-YOUR_KEY"
```

2. Or in `~/.pi/agent/.env`:

```bash
FIRECRAWL_API_KEY=fc-YOUR_KEY
```

`.env` is ignored by git. Use `.env.example` as the template.

## Install dependencies

From this directory:

```bash
cd ~/.pi/agent
npm install
```

## Reloading Pi

After changing extensions or themes, run this inside Pi:

```text
/reload
```

Or restart Pi.

## Git notes

This directory is a git repository. Secrets and runtime state are ignored:

- `.env`
- `auth.json`
- `sessions/`
- `node_modules/`
- Pi package caches

Safe files to commit include:

- `README.md`
- `package.json`
- `package-lock.json`
- `settings.json`
- `.gitignore`
- `.env.example`
- `extensions/`
- `themes/`
