import { describe, expect, test } from "bun:test";
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
