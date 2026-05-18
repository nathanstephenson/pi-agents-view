import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentsModalComponent } from "./modal.js";
import type { ManagedSessionRow } from "./types.js";

const AGENTS_VIEW_STATUS_ID = "agents-view";

async function openAgentsView(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Agents view requires the interactive TUI", "warning");
		return;
	}

	const rows = getInitialRows(ctx);

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const modal = new AgentsModalComponent({
				theme,
				getRows: () => rows,
				onCreate: (prompt) => {
					ctx.ui.notify(`Background sessions are coming next: ${prompt}`, "info");
				},
				onOpen: (rowId) => {
					const row = rows.find((candidate) => candidate.id === rowId);
					ctx.ui.notify(row ? `${row.title} cannot be opened in this slice` : "No row selected", "info");
				},
				onClose: () => done(),
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

function getInitialRows(ctx: ExtensionContext): ManagedSessionRow[] {
	return [
		{
			id: "current",
			source: "current-pi",
			title: "Current Pi session",
			status: ctx.isIdle() ? "current" : "running",
			updatedAt: Date.now(),
			isStreaming: !ctx.isIdle(),
		},
		{
			id: "fake-background",
			source: "sdk-live",
			title: "Example background session",
			promptPreview: "Fake row for modal shell",
			status: "waiting",
			updatedAt: Date.now() - 1,
		},
	];
}

export default function agentsViewExtension(pi: ExtensionAPI): void {
	pi.registerFlag("agents", {
		description: "Open the agents view on startup",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("agents", {
		description: "Open the agents view",
		handler: async (_args, ctx) => {
			await openAgentsView(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

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
