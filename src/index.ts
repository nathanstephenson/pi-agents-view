import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentsModalComponent } from "./modal.js";
import { AgentsSessionRegistry } from "./registry.js";
import type { ManagedSessionRow } from "./types.js";

const AGENTS_VIEW_STATUS_ID = "agents-view";
const AGENTS_WIDGET_ID = "agents-view";

interface AgentsWidgetBinding {
	setModalOpen(isOpen: boolean): void;
	unsubscribe(): void;
}

export function runningSdkRowCount(registry: Pick<AgentsSessionRegistry, "getRows">): number {
	return registry.getRows().filter((row) => row.source === "sdk-live" && (row.isStreaming || row.status === "running")).length;
}

export function bindAgentsWidget(
	ctx: Pick<ExtensionContext, "ui">,
	registry: Pick<AgentsSessionRegistry, "getRows" | "subscribe">,
): AgentsWidgetBinding {
	let modalOpen = false;
	const update = () => {
		const running = runningSdkRowCount(registry);
		if (!modalOpen && running > 0) {
			ctx.ui.setWidget(AGENTS_WIDGET_ID, [`Agents: ${running} running · /agents open`], { placement: "belowEditor" });
		} else {
			ctx.ui.setWidget(AGENTS_WIDGET_ID, undefined);
		}
	};
	const unsubscribeRegistry = registry.subscribe(update);
	update();
	return {
		setModalOpen(isOpen: boolean) {
			modalOpen = isOpen;
			update();
		},
		unsubscribe() {
			unsubscribeRegistry();
			ctx.ui.setWidget(AGENTS_WIDGET_ID, undefined);
		},
	};
}

export async function openSessionRow(
	row: ManagedSessionRow | undefined,
	ctx: ExtensionCommandContext,
	beforeSwitch?: () => void,
): Promise<boolean> {
	if (!row?.sessionFile) {
		ctx.ui.notify("No session file to open", "warning");
		return false;
	}

	if (row.source === "sdk-live") {
		if (row.isStreaming || row.sdk?.session.isStreaming || row.status === "running" || row.status === "queued") {
			ctx.ui.notify("Session is running; inspect or abort it first", "warning");
			return false;
		}

		if (row.status === "aborting") {
			ctx.ui.notify("Session is still aborting; wait until it is idle", "warning");
			return false;
		}

		row.sdk?.unsubscribe();
		row.sdk?.session.dispose();
		row.sdk = undefined;
		row.isStreaming = false;
		row.activeTool = undefined;
	}

	const sessionFile = row.sessionFile;
	beforeSwitch?.();
	await ctx.waitForIdle();
	await ctx.switchSession(sessionFile);
	return true;
}

async function openAgentsView(
	ctx: ExtensionCommandContext,
	registry: AgentsSessionRegistry,
	widgetBinding?: AgentsWidgetBinding,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Agents view requires the interactive TUI", "warning");
		return;
	}

	registry.refreshCurrent(ctx);
	void registry.refreshRecent(ctx.cwd).catch((error) => {
		ctx.ui.notify(`Failed to load recent sessions: ${error instanceof Error ? error.message : String(error)}`, "warning");
	});

	widgetBinding?.setModalOpen(true);
	try {
		await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const unsubscribe = registry.subscribe(() => tui.requestRender());
			const close = () => {
				unsubscribe();
				done();
			};
			const maxPromptLines = () => {
				const rowCount = registry.getRows().length;
				const visibleRowCount = rowCount === 0 ? 1 : Math.min(rowCount, 5);
				const fixedLineCount = 6 + visibleRowCount;
				const overlayRows = Math.max(1, Math.floor(tui.terminal.rows * 0.8));
				return Math.max(1, Math.min(10, overlayRows - fixedLineCount));
			};
			const modal = new AgentsModalComponent({
				theme,
				getRows: () => registry.getRows(),
				onCreate: (prompt) => {
					void registry.startBackgroundSession(prompt, ctx).catch((error) => {
						ctx.ui.notify(
							`Failed to start background session: ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						);
					});
				},
				onOpen: (rowId) => {
					const row = registry.getRow(rowId);
					void openSessionRow(row, ctx, close).catch((error) => {
						ctx.ui.notify(`Failed to open session: ${error instanceof Error ? error.message : String(error)}`, "warning");
					});
				},
				onAbort: (rowId) => {
					void registry.abortSession(rowId).catch((error) => {
						ctx.ui.notify(`Failed to abort session: ${error instanceof Error ? error.message : String(error)}`, "warning");
					});
				},
				onClose: close,
				onInvalidate: () => tui.requestRender(),
				maxPromptLines,
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
	} finally {
		widgetBinding?.setModalOpen(false);
	}
}

export default function agentsViewExtension(pi: ExtensionAPI): void {
	const registry = new AgentsSessionRegistry();
	let widgetBinding: AgentsWidgetBinding | undefined;

	pi.registerFlag("agents", {
		description: "Open the agents view on startup",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("agents", {
		description: "Open the agents view",
		handler: async (_args, ctx) => {
			if (!widgetBinding && ctx.hasUI) widgetBinding = bindAgentsWidget(ctx, registry);
			await openAgentsView(ctx, registry, widgetBinding);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		widgetBinding?.unsubscribe();
		widgetBinding = bindAgentsWidget(ctx, registry);
		registry.refreshCurrent(ctx);
		void registry.refreshRecent(ctx.cwd);
		ctx.ui.setStatus(AGENTS_VIEW_STATUS_ID, ctx.ui.theme.fg("dim", "agents:view"));

		if (pi.getFlag("agents") === true) {
			ctx.ui.notify("Run /agents to open the agents view", "info");
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		widgetBinding?.unsubscribe();
		widgetBinding = undefined;
		registry.disposeAll();
		if (ctx.hasUI) {
			ctx.ui.setStatus(AGENTS_VIEW_STATUS_ID, undefined);
			ctx.ui.setWidget(AGENTS_WIDGET_ID, undefined);
		}
	});
}
