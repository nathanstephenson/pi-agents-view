import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentsModalComponent } from "./modal.js";
import { AgentsSessionRegistry } from "./registry.js";
import type { ManagedSessionRow } from "./types.js";

const AGENTS_VIEW_STATUS_ID = "agents-view";

export async function openRecentRow(row: ManagedSessionRow | undefined, ctx: ExtensionCommandContext): Promise<void> {
	if (!row?.sessionFile) {
		ctx.ui.notify("No session file to open", "warning");
		return;
	}

	await ctx.waitForIdle();
	await ctx.switchSession(row.sessionFile);
}

async function openAgentsView(ctx: ExtensionCommandContext, registry: AgentsSessionRegistry): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Agents view requires the interactive TUI", "warning");
		return;
	}

	registry.refreshCurrent(ctx);
	void registry.refreshRecent(ctx.cwd).catch((error) => {
		ctx.ui.notify(`Failed to load recent sessions: ${error instanceof Error ? error.message : String(error)}`, "warning");
	});

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const unsubscribe = registry.subscribe(() => tui.requestRender());
			const close = () => {
				unsubscribe();
				done();
			};
			const modal = new AgentsModalComponent({
				theme,
				getRows: () => registry.getRows(),
				onCreate: (prompt) => {
					ctx.ui.notify(`Background sessions are coming next: ${prompt}`, "info");
				},
				onOpen: (rowId) => {
					const row = registry.getRow(rowId);
					void openRecentRow(row, ctx).catch((error) => {
						ctx.ui.notify(`Failed to open session: ${error instanceof Error ? error.message : String(error)}`, "warning");
					});
				},
				onClose: close,
				onInvalidate: () => tui.requestRender(),
			});
			modal.focused = true;
			return modal;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "right-center",
				width: "55%",
				minWidth: 52,
				maxHeight: "80%",
				margin: 1,
			},
		},
	);
}

export default function agentsViewExtension(pi: ExtensionAPI): void {
	const registry = new AgentsSessionRegistry();

	pi.registerFlag("agents", {
		description: "Open the agents view on startup",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("agents", {
		description: "Open the agents view",
		handler: async (_args, ctx) => {
			await openAgentsView(ctx, registry);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		registry.refreshCurrent(ctx);
		void registry.refreshRecent(ctx.cwd);
		ctx.ui.setStatus(AGENTS_VIEW_STATUS_ID, ctx.ui.theme.fg("dim", "agents:view"));

		if (pi.getFlag("agents") === true) {
			ctx.ui.notify("Run /agents to open the agents view", "info");
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(AGENTS_VIEW_STATUS_ID, undefined);
		}
	});
}
