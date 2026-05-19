import {
	CURSOR_MARKER,
	Key,
	decodeKittyPrintable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";
import type { ManagedSessionRow, TranscriptEntry } from "./types.js";

type AgentsModalBg = "customMessageBg" | "selectedBg";

export interface AgentsModalTheme {
	fg(name: string, text: string): string;
	bg?: (name: AgentsModalBg, text: string) => string;
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
	maxVisibleRows?: number | (() => number);
	maxPromptLines?: number | (() => number);
	maxHeightLines?: number | (() => number);
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
		const wrappedPromptLines = this.promptInputLines(innerWidth, this.maxPromptLines());
		const layout = this.listLayout(rows.length, wrappedPromptLines.length);
		const promptLines = wrappedPromptLines.slice(-layout.promptLines);

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
			const firstVisibleRow = this.firstVisibleRow(rows.length, layout.listLines);
			const visibleRows = this.visibleRows(rows, layout.listLines);
			for (const [offset, row] of visibleRows.entries()) {
				const index = offset + firstVisibleRow;
				const selected = index === this.selectedIndex;
				const marker = selected ? ">" : " ";
				const icon = row.source === "current-pi" ? "◆" : row.source === "recent-file" ? "○" : "●";
				const detail = row.activeTool ? `tool: ${row.activeTool}` : row.assistantPreview || row.promptPreview || "";
				const text = `${marker} ${icon} ${row.title}  ${row.status}${detail ? `  ${detail}` : ""}`;
				lines.push(this.line(selected ? this.options.theme.fg("accent", text) : text, innerWidth));
			}
			for (let index = visibleRows.length; index < layout.listLines; index++) lines.push(this.line("", innerWidth));
		}

		if (rows.length === 0 && layout.listLines > 1) {
			for (let index = 1; index < layout.listLines; index++) lines.push(this.line("", innerWidth));
		}

		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		for (const promptLine of promptLines) lines.push(this.line(promptLine, innerWidth));
		lines.push(this.line(this.options.theme.fg("dim", "↑↓ select · Enter create/open · → open · Esc close"), innerWidth));
		lines.push(`└${"─".repeat(innerWidth + 2)}┘`);
		return lines.map((line) => this.opaqueLine(line, width));
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

		const frameWidth = innerWidth + 4;
		const title = truncateToWidth(row.title, Math.max(1, innerWidth - 1), "…", true);
		const maxHeight = this.maxHeightLines();
		const lines = [
			`┌ ${this.options.theme.fg("accent", title)} ${"─".repeat(Math.max(0, innerWidth - visibleCellCount(title) - 2))}┐`,
			this.line(row.activeTool ? `${row.status} · tool: ${row.activeTool}` : row.status, innerWidth),
		];
		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		const viewportHeight = maxHeight ? Math.max(1, maxHeight - lines.length - 3) : 6;
		const transcriptLines = this.transcriptLines(row, innerWidth);
		const visibleTranscriptLines = transcriptLines.slice(Math.max(0, transcriptLines.length - viewportHeight));
		for (const transcriptLine of visibleTranscriptLines) lines.push(this.line(transcriptLine, innerWidth));
		if (maxHeight) {
			while (lines.length < maxHeight - 3) lines.push(this.line("", innerWidth));
		}
		lines.push(`├${"─".repeat(innerWidth + 2)}┤`);
		lines.push(this.line(this.options.theme.fg("dim", "↑ scroll · a abort · o open when idle · ← back · Esc close"), innerWidth));
		lines.push(`└${"─".repeat(innerWidth + 2)}┘`);
		return lines.map((line) => this.opaqueLine(line, frameWidth));
	}

	private transcriptLines(row: ManagedSessionRow, width: number): string[] {
		const entries = row.transcript?.filter((entry) => entry.text.trim() || entry.title?.trim()) ?? [];
		if (entries.length === 0) {
			return this.wrapText(row.assistantPreview || row.errorMessage || row.promptPreview || "No output yet.", width);
		}

		const lines: string[] = [];
		for (const entry of entries) {
			if (lines.length > 0) lines.push("");
			const label = this.transcriptLabel(entry);
			const text = entry.text || "";
			const firstPrefix = label ? `${label} ` : "";
			const wrapped = this.wrapText(text || entry.title || "", width, firstPrefix, label ? " ".repeat(visibleCellCount(firstPrefix)) : "");
			lines.push(...wrapped);
		}
		return lines;
	}

	private transcriptLabel(entry: TranscriptEntry): string {
		if (entry.kind === "user") return this.options.theme.fg("accent", this.options.theme.bold("You:"));
		if (entry.kind === "assistant") return this.options.theme.bold("Assistant:");
		if (entry.kind === "error") return this.options.theme.fg("error", this.options.theme.bold("Error:"));
		if (entry.kind === "notice") return this.options.theme.fg("dim", "Notice:");
		const title = entry.title ? ` ${entry.title}` : "";
		const status = entry.status ? ` ${entry.status}` : "";
		return this.options.theme.fg("dim", `Tool${title}${status}:`);
	}

	private wrapText(text: string, width: number, firstPrefix = "", continuationPrefix = ""): string[] {
		const sourceLines = text.split(/\r?\n/);
		const wrapped: string[] = [];
		for (const sourceLine of sourceLines) {
			let remaining = sourceLine || "";
			let prefix = firstPrefix;
			do {
				const available = Math.max(1, width - visibleCellCount(prefix));
				const chars = Array.from(remaining);
				const chunk = chars.slice(0, available).join("");
				wrapped.push(`${prefix}${chunk}`);
				remaining = chars.slice(available).join("");
				prefix = continuationPrefix;
			} while (remaining.length > 0);
			firstPrefix = continuationPrefix;
		}
		return wrapped.length ? wrapped : [firstPrefix];
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

	private listLayout(rowCount: number, wrappedPromptLineCount: number): { listLines: number; promptLines: number } {
		const maxHeight = this.maxHeightLines();
		const configuredRows = this.optionNumber(this.options.maxVisibleRows) ?? (maxHeight ? Number.POSITIVE_INFINITY : 5);
		if (!maxHeight) {
			return {
				listLines: Math.max(1, Math.min(rowCount || 1, configuredRows)),
				promptLines: Math.max(1, wrappedPromptLineCount),
			};
		}

		const minimumListLines = 1;
		const promptLines = Math.max(1, Math.min(wrappedPromptLineCount, maxHeight - 6 - minimumListLines));
		const listLines = Math.max(minimumListLines, Math.min(configuredRows, maxHeight - 6 - promptLines));
		return { listLines, promptLines };
	}

	private firstVisibleRow(rowCount: number, maxVisible: number): number {
		return Math.min(Math.max(0, this.selectedIndex - maxVisible + 1), Math.max(0, rowCount - maxVisible));
	}

	private visibleRows(rows: ManagedSessionRow[], maxVisible: number): ManagedSessionRow[] {
		const start = this.firstVisibleRow(rows.length, maxVisible);
		return rows.slice(start, start + maxVisible);
	}

	private promptInputLines(width: number, maxLines = this.maxPromptLines()): string[] {
		const label = "New session: ";
		const continuation = " ".repeat(label.length);
		const firstWidth = Math.max(1, width - label.length);
		const continuationWidth = Math.max(1, width - continuation.length);
		const prompt = this.prompt || this.options.theme.fg("dim", "Type prompt…");
		const cursor = this.prompt ? "▌" : "";
		const chars = Array.from(`${prompt}${cursor}`);
		const wrapped: string[] = [];
		let index = 0;
		let first = true;
		do {
			const prefix = first ? label : continuation;
			const chunkWidth = first ? firstWidth : continuationWidth;
			const chunk = chars.slice(index, index + chunkWidth).join("");
			wrapped.push(`${prefix}${chunk}`);
			index += chunkWidth;
			first = false;
		} while (index < chars.length);
		if (this.prompt && this.focused) {
			const lastLine = wrapped[wrapped.length - 1];
			wrapped[wrapped.length - 1] = `${lastLine.slice(0, -1)}${CURSOR_MARKER}${lastLine.slice(-1)}`;
		}
		return wrapped.slice(-maxLines);
	}

	private maxPromptLines(): number {
		return Math.max(1, Math.min(10, this.optionNumber(this.options.maxPromptLines) ?? 10));
	}

	private maxHeightLines(): number | undefined {
		const configured = this.optionNumber(this.options.maxHeightLines);
		return configured === undefined ? undefined : Math.max(8, configured);
	}

	private optionNumber(option: number | (() => number) | undefined): number | undefined {
		const value = typeof option === "function" ? option() : option;
		if (value === undefined || !Number.isFinite(value)) return undefined;
		return Math.max(1, Math.floor(value));
	}

	private line(content: string, width: number): string {
		const singleLineContent = content.replace(/[\r\n\t]+/g, " ");
		const text = truncateToWidth(singleLineContent, width, "…", true);
		return this.padLine(`│ ${this.padLine(text, width)} │`, width + 4);
	}

	private opaqueLine(line: string, width: number): string {
		const padded = this.padLine(line, width);
		const bg = this.backgroundParts();
		if (!bg) return padded;
		return `${bg.open}${padded.replaceAll("\x1b[0m", `\x1b[0m${bg.open}`)}${bg.close}`;
	}

	private backgroundParts(): { open: string; close: string } | undefined {
		const sentinel = "__PI_AGENTS_MODAL_BG__";
		const wrapped =
			this.options.theme.bg?.("customMessageBg", sentinel) ?? this.options.theme.bg?.("selectedBg", sentinel);
		if (!wrapped) return undefined;
		const index = wrapped.indexOf(sentinel);
		if (index === -1) return undefined;
		return { open: wrapped.slice(0, index), close: wrapped.slice(index + sentinel.length) };
	}

	private padLine(line: string, width: number, pad = " "): string {
		return `${line}${pad.repeat(Math.max(0, width - visibleWidth(line)))}`;
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
