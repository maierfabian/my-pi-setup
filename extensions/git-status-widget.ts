import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Disabled: git status is now folded into the minimal header in flow-title.ts.
const WIDGET_ID = "git-status-widget";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
  });
}
