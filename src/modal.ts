import {
	CURSOR_MARKER,
	Key,
	decodeKittyPrintable,
	matchesKey,
	truncateToWidth,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";
import type { ManagedSessionRow } from "./types.js";

export interface AgentsModalTheme {
	fg(name: string, text: string): string;
	bold(text: string): string;
}

interface AgentsModalOptions {
	theme: AgentsModalTheme;
	getRows: () => ManagedSessionRow[];
	onCreate: (prompt: string) => void;
	onOpen: (rowId: string) => void;
	onAbort: (rowId: string) => void;
	onClose: () => void;
	onInvalidate?: () => void;
}

export class AgentsModalComponent implements Component, Focusable {
	focused = false;
	private selectedIndex = 0;
	private prompt = "";
	private mode: "list" | "detail" = "list";
	private detailRowId: string | undefined;

	constructor(private readonly options: AgentsModalOptions) {}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 4);
		const rows = this.rows();
		this.clampSelection(rows.length);
		if (this.mode === "detail") return this.renderDetail(innerWidth);

		const running = rows.filter((row) => row.status === "running" || row.isStreaming).length;
		const waiting = rows.filter((row) => row.status === "waiting" || row.status === "queued").length;
		const recent = rows.filter((row) => row.source === "recent-file").length;
		const lines = [
			`┌ ${this.options.theme.fg("accent", "Agents")} ${"─".repeat(Math.max(0, innerWidth - 8))}┐`,
			this.line(`${running} running · ${waiting} waiting · ${recent} recent`, innerWidth),
			`├${"─".repeat(innerWidth + 2)}┤`,
		];

		if (rows.length === 0) {
			lines.push(this.line(this.options.theme.fg("dim", "No sessions yet."), innerWidth));
		} else {
			for (const [index, row] of rows.entries()) {
				const selected = index === this.selectedIndex;
				const marker = selected ? ">" : " ";
				const icon = row.source === "current-pi" ? "◆" : row.source === "recent-file" ? "○" : "●";
				const detail = row.activeTool ? `tool: ${row.activeTool}` : row.assistantPreview || row.promptPreview || "";
				const text = `${marker} ${icon} ${row.title}  ${row.status}${detail ? `  ${detail}` : ""}`;
				lines.push(this.line(selected ? this.options.theme.fg("accent", text) : text, innerWidth));
			}
		}

		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		const cursor = this.focused ? CURSOR_MARKER : "▌";
		lines.push(this.line(`New session: ${this.prompt}${cursor}`, innerWidth));
		lines.push(this.line(this.options.theme.fg("dim", "↑↓ select · Enter create/open · → open · Esc close"), innerWidth));
		lines.push(`└${"─".repeat(innerWidth + 2)}┘`);
		return lines;
	}

	handleInput(data: string): void {
		if (this.mode === "detail") {
			this.handleDetailInput(data);
			this.invalidate();
			return;
		}

		const rows = this.rows();
		if (matchesKey(data, Key.up)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		} else if (matchesKey(data, Key.down)) {
			this.selectedIndex = Math.min(Math.max(0, rows.length - 1), this.selectedIndex + 1);
		} else if (matchesKey(data, Key.escape)) {
			this.options.onClose();
		} else if (matchesKey(data, Key.backspace)) {
			this.prompt = Array.from(this.prompt).slice(0, -1).join("");
		} else if (matchesKey(data, Key.enter)) {
			const prompt = this.prompt.trim();
			if (prompt) {
				this.prompt = "";
				this.options.onCreate(prompt);
			} else {
				this.openSelected(rows);
			}
		} else if (matchesKey(data, Key.right)) {
			this.openSelected(rows);
		} else {
			const printable = printableInput(data);
			if (printable) this.prompt += printable;
		}

		this.invalidate();
	}

	invalidate(): void {
		this.options.onInvalidate?.();
	}

	private openSelected(rows: ManagedSessionRow[]): void {
		const row = rows[this.selectedIndex];
		if (!row) return;
		if (isRunningSdkRow(row)) {
			this.mode = "detail";
			this.detailRowId = row.id;
			return;
		}
		this.options.onOpen(row.id);
	}

	private handleDetailInput(data: string): void {
		const row = this.detailRow();
		if (matchesKey(data, Key.left)) {
			this.mode = "list";
			this.detailRowId = undefined;
		} else if (matchesKey(data, Key.escape)) {
			this.options.onClose();
		} else if (data === "a" && row) {
			this.options.onAbort(row.id);
		} else if (data === "o" && row && !isRunningSdkRow(row)) {
			this.options.onOpen(row.id);
		}
	}

	private renderDetail(innerWidth: number): string[] {
		const row = this.detailRow();
		if (!row) {
			this.mode = "list";
			this.detailRowId = undefined;
			return this.render(innerWidth + 4);
		}

		const title = truncateToWidth(row.title, Math.max(1, innerWidth - 1), "…", true);
		const lines = [
			`┌ ${this.options.theme.fg("accent", title)} ${"─".repeat(Math.max(0, innerWidth - visibleCellCount(title) - 2))}┐`,
			this.line(`Status: ${row.status}`, innerWidth),
		];
		if (row.activeTool) lines.push(this.line(`Tool: ${row.activeTool}`, innerWidth));
		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		const preview = row.assistantPreview || row.errorMessage || row.promptPreview || "No output yet.";
		for (const line of preview.split(/\r?\n/).slice(0, 6)) lines.push(this.line(line, innerWidth));
		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		lines.push(this.line(this.options.theme.fg("dim", "a abort · o open when idle · ← back · Esc close"), innerWidth));
		lines.push(`└${"─".repeat(innerWidth + 2)}┘`);
		return lines;
	}

	private detailRow(): ManagedSessionRow | undefined {
		return this.rows().find((row) => row.id === this.detailRowId);
	}

	private rows(): ManagedSessionRow[] {
		return this.options.getRows();
	}

	private clampSelection(rowCount: number): void {
		this.selectedIndex = Math.min(Math.max(0, this.selectedIndex), Math.max(0, rowCount - 1));
	}

	private line(content: string, width: number): string {
		return `│ ${truncateToWidth(content, width, "…", true)} │`;
	}
}

function printableInput(data: string): string | undefined {
	const kitty = decodeKittyPrintable(data);
	if (kitty) return kitty;
	if (data.length === 1 && data >= " " && data !== "\x7f") return data;
	return undefined;
}

function isRunningSdkRow(row: ManagedSessionRow): boolean {
	return row.source === "sdk-live" && (row.isStreaming === true || row.status === "running" || row.status === "queued" || row.status === "aborting");
}

function visibleCellCount(text: string): number {
	return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}
