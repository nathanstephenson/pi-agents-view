import { describe, expect, test } from "bun:test";
import { AgentsModalComponent } from "./modal.js";
import type { ManagedSessionRow } from "./types.js";

const theme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

function row(id: string, title: string): ManagedSessionRow {
	return {
		id,
		source: "recent-file",
		title,
		status: "recent",
		updatedAt: Date.now(),
	};
}

describe("AgentsModalComponent", () => {
	test("renders list rows", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First session"), row("two", "Second session")],
			onCreate: () => {},
			onOpen: () => {},
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
			onClose: () => {},
		});

		for (const char of "abc") modal.handleInput(char);
		modal.handleInput("\x7f");
		modal.handleInput("d");
		modal.handleInput("\r");

		expect(created).toEqual(["abd"]);
		expect(modal.render(90).join("\n")).toContain("New session: ▌");
	});

	test("right opens selected row and escape closes", () => {
		const opened: string[] = [];
		let closed = false;
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "First")],
			onCreate: () => {},
			onOpen: (id) => opened.push(id),
			onClose: () => {
				closed = true;
			},
		});

		modal.handleInput("\u001b[C");
		modal.handleInput("\u001b");

		expect(opened).toEqual(["one"]);
		expect(closed).toBe(true);
	});
});
