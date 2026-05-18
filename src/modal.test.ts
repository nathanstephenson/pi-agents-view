import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { AgentsModalComponent } from "./modal.js";
import type { ManagedSessionRow } from "./types.js";

const theme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

function row(id: string, title: string, overrides: Partial<ManagedSessionRow> = {}): ManagedSessionRow {
	return {
		id,
		source: "recent-file",
		title,
		status: "recent",
		updatedAt: Date.now(),
		...overrides,
	};
}

const noop = () => {};

describe("AgentsModalComponent", () => {
	test("renders list rows", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First session"), row("two", "Second session")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		expect(modal.render(90).join("\n")).toContain("First session");
		expect(modal.render(90).join("\n")).toContain("Second session");
	});

	test("moves selection down and opens selected row", () => {
		const opened: string[] = [];
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First"), row("two", "Second")],
			onCreate: () => {},
			onOpen: (id) => opened.push(id),
			onAbort: noop,
			onClose: () => {},
		});

		modal.handleInput("\u001b[B");
		modal.handleInput("\r");

		expect(opened).toEqual(["two"]);
	});

	test("keeps long lists inside a fixed viewport while selecting past visible rows", () => {
		const rows = Array.from({ length: 8 }, (_, index) => row(`row-${index}`, `Session ${index}`));
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => rows,
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxVisibleRows: 3,
		});

		for (let i = 0; i < 7; i++) modal.handleInput("\u001b[B");
		const rendered = modal.render(90).join("\n");

		expect(rendered).not.toContain("Session 0");
		expect(rendered).not.toContain("Session 4");
		expect(rendered).toContain("Session 5");
		expect(rendered).toContain("Session 6");
		expect(rendered).toContain("Session 7");
		expect(modal.render(90)).toHaveLength(10);
	});

	test("renders every line at the same visible width to clear old overlay content", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "A very long session title that previously left stale terminal cells behind"), row("two", "Short")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		const rendered = modal.render(40);
		const widths = new Set(rendered.map((line) => visibleWidth(line)));

		expect(widths).toEqual(new Set([40]));
	});

	test("caps default list height to fit compact overlays", () => {
		const rows = Array.from({ length: 20 }, (_, index) => row(`row-${index}`, `Session ${index}`));
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => rows,
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		const rendered = modal.render(90);
		const sessionLines = rendered.filter((line) => line.includes("Session "));

		expect(sessionLines).toHaveLength(5);
		expect(rendered).toHaveLength(12);
	});

	test("edits prompt, creates on enter, and clears prompt", () => {
		const created: string[] = [];
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First")],
			onCreate: (prompt) => created.push(prompt),
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		for (const char of "abc") modal.handleInput(char);
		modal.handleInput("\x7f");
		modal.handleInput("d");
		modal.handleInput("\r");

		expect(created).toEqual(["abd"]);
		expect(modal.render(90).join("\n")).toContain("New session: ▌");
	});

	test("right opens selected idle row and escape closes", () => {
		const opened: string[] = [];
		let closed = false;
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First")],
			onCreate: () => {},
			onOpen: (id) => opened.push(id),
			onAbort: () => {},
			onClose: () => {
				closed = true;
			},
		});

		modal.handleInput("\u001b[C");
		modal.handleInput("\u001b");

		expect(opened).toEqual(["one"]);
		expect(closed).toBe(true);
	});

	test("right enters detail for running sdk row and left returns to list", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Fix auth tests", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					activeTool: "grep",
					assistantPreview: "Latest output preview",
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: () => {},
			onClose: () => {},
		});

		modal.handleInput("\u001b[C");
		const detail = modal.render(90).join("\n");

		expect(detail).toContain("Fix auth tests");
		expect(detail).toContain("Status: running");
		expect(detail).toContain("Tool: grep");
		expect(detail).toContain("Latest output preview");

		modal.handleInput("\u001b[D");

		expect(modal.render(90).join("\n")).toContain("New session:");
	});

	test("detail aborts running row and opens idle row", () => {
		const aborted: string[] = [];
		const opened: string[] = [];
		let rows = [
			row("run", "Fix auth tests", {
				source: "sdk-live",
				status: "running",
				isStreaming: true,
			}),
		];
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => rows,
			onCreate: () => {},
			onOpen: (id) => opened.push(id),
			onAbort: (id) => aborted.push(id),
			onClose: () => {},
		});

		modal.handleInput("\u001b[C");
		modal.handleInput("a");
		expect(aborted).toEqual(["run"]);

		rows = [row("run", "Fix auth tests", { source: "sdk-live", status: "aborted", isStreaming: false })];
		modal.handleInput("o");
		expect(opened).toEqual(["run"]);
	});
});
