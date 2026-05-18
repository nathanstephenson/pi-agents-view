import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const AGENTS_VIEW_STATUS_ID = "agents-view";

async function openAgentsView(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Agents view requires the interactive TUI", "warning");
		return;
	}

	const items: SelectItem[] = [
		{
			value: "agents",
			label: "Agents",
			description: "Browse configured subagents and launch agent workflows (coming next)",
		},
		{
			value: "chains",
			label: "Chains",
			description: "Browse saved subagent chains and pipeline templates (coming next)",
		},
		{
			value: "runs",
			label: "Runs",
			description: "Inspect active and recent subagent runs (coming next)",
		},
	];

	const selected = await ctx.ui.custom<string | null>(
		(tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Agents View")), 1, 0));
			container.addChild(
				new Text(theme.fg("dim", "Foundation loaded. Pick a section; deeper agent data is next."), 1, 0),
			);

			const list = new SelectList(items, items.length, {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
			container.addChild(list);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc close"), 1, 0));
			container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					list.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "right-center",
				width: "45%",
				minWidth: 48,
				maxHeight: "80%",
				margin: 1,
			},
		},
	);

	if (selected) {
		ctx.ui.notify(`${selected} view is not implemented yet`, "info");
	}
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
			await openAgentsView(ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(AGENTS_VIEW_STATUS_ID, undefined);
		}
	});
}
