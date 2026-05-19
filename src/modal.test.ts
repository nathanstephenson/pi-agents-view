import { describe, expect, test } from "bun:test";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { AgentsModalComponent } from "./modal.js";
import type { ManagedSessionRow } from "./types.js";

const theme = {
	fg: (_name: string, text: string) => text,
	bg: (_name: string, text: string) => text,
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

	test("renders every line with opaque background", () => {
		const opaqueTheme = {
			fg: (_name: string, text: string) => text,
			bg: (name: string, text: string) => `<${name}>${text}</${name}>`,
			bold: (text: string) => text,
		};
		const modal = new AgentsModalComponent({
			theme: opaqueTheme,
			getRows: () => [row("one", "First")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 8,
		});

		for (const line of modal.render(90)) expect(line).toContain("<customMessageBg>");
	});

	test("reapplies modal background after truncate resets", () => {
		const ansiTheme = {
			fg: (name: string, text: string) => (name === "accent" ? `\x1b[33m${text}\x1b[0m` : text),
			bg: (_name: string, text: string) => `\x1b[48;5;235m${text}\x1b[49m`,
			bold: (text: string) => text,
		};
		const modal = new AgentsModalComponent({
			theme: ansiTheme,
			getRows: () => [row("one", "A very long selected session title that must truncate near the right edge")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		const selectedRow = modal.render(40).find((line) => line.includes("A very long"));

		expect(selectedRow).toContain("\x1b[0m\x1b[48;5;235m");
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

	test("keeps multiline row content on one terminal line", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("one", "Title", {
					assistantPreview: "first line\nReferences are relative to /tmp/path\nthird line",
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 8,
		});

		const rendered = modal.render(80);

		expect(rendered).toHaveLength(8);
		expect(rendered.every((line) => !line.includes("\n") && !line.includes("\r"))).toBe(true);
		expect(new Set(rendered.map((line) => visibleWidth(line)))).toEqual(new Set([80]));
	});

	test("caps modal frame width on wide terminals", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "Only session")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 8,
		});

		const rendered = modal.render(200).join("\n");

		expect(rendered).toContain("┌ Agents ");
		expect(rendered).toContain("│ > ○ Only session");
		expect(visibleWidth(rendered.split("\n")[0] ?? "")).toBe(200);
	});

	test("uses available modal height for as many rows as fit", () => {
		const rows = Array.from({ length: 20 }, (_, index) => row(`row-${index}`, `Session ${index}`));
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => rows,
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 14,
		});

		const rendered = modal.render(90);
		const sessionLines = rendered.filter((line) => line.includes("Session "));

		expect(sessionLines).toHaveLength(7);
		expect(rendered).toHaveLength(14);
	});

	test("pads fixed-height modal so background sits behind it", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "Only session")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 12,
		});

		const rendered = modal.render(90);

		expect(rendered).toHaveLength(12);
		expect(rendered.filter((line) => line.includes("Only session"))).toHaveLength(1);
		expect(rendered.filter((line) => /│\s+│/.test(line))).toHaveLength(4);
	});

	test("honors the minimum fixed modal height", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("one", "Only session")],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 7,
		});

		expect(modal.render(90)).toHaveLength(8);
	});

	test("wrapped prompt text reduces visible sessions and keeps bottom selection visible", () => {
		const rows = Array.from({ length: 8 }, (_, index) => row(`row-${index}`, `Session ${index}`));
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => rows,
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 12,
		});

		for (let i = 0; i < 7; i++) modal.handleInput("\u001b[B");
		for (const char of "abcdefghijklmnopqrstuvwxyz") modal.handleInput(char);
		const rendered = modal.render(20).join("\n");

		expect(rendered).not.toContain("Session 5");
		expect(rendered).toContain("Session 6");
		expect(rendered).toContain("Session 7");
		expect(rendered.split("\n")).toHaveLength(12);
		expect(rendered.split("\n").filter((line) => line.includes("Session "))).toHaveLength(2);
	});

	test("renders an empty prompt with dim placeholder and no cursor", () => {
		const themed = {
			fg: (name: string, text: string) => (name === "dim" ? `<dim>${text}</dim>` : text),
			bold: (text: string) => text,
		};
		const modal = new AgentsModalComponent({
			theme: themed,
			getRows: () => [],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		const rendered = modal.render(90).join("\n");

		expect(rendered).toContain("New session: <dim>Type prompt…</dim>");
		expect(rendered).not.toContain("Type prompt…</dim>▌");
	});

	test("emits the hardware cursor marker when focused", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		modal.focused = true;

		modal.handleInput("a");

		expect(modal.render(90).join("\n")).toContain(`New session: a${CURSOR_MARKER}▌`);
	});

	test("does not split the hardware cursor marker when focused text wraps", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		modal.focused = true;
		for (const char of "abcdefg") modal.handleInput(char);

		const promptLines = modal.render(20).filter((line) => line.includes("New session:") || line.includes("│              "));

		expect(promptLines[0]).toContain("New session: abcdefg");
		expect(promptLines[1]).toContain(`             ${CURSOR_MARKER}▌`);
		expect(promptLines.join("\n")).not.toContain("│              _pi:c");
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
		expect(modal.render(90).join("\n")).toContain("New session: Type prompt…");
		expect(modal.render(90).join("\n")).not.toContain("Type prompt…▌");
	});

	test("grows prompt box up to ten wrapped lines then scrolls to cursor", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		for (const char of "abcdefghijklmnopqrstuvwxy") modal.handleInput(char);
		const fourWrappedLines = modal.render(20);
		expect(fourWrappedLines.filter((line) => line.includes("New session:") || line.includes("│              "))).toHaveLength(4);
		expect(fourWrappedLines.join("\n")).toContain("vwxy");

		for (const char of "z0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") modal.handleInput(char);
		const scrolled = modal.render(20);
		const promptLines = scrolled.filter((line) => line.includes("New session:") || line.includes("│              "));
		expect(promptLines).toHaveLength(10);
		expect(scrolled.join("\n")).not.toContain("New session: abcdef");
		expect(scrolled.join("\n")).toContain("z▌");
	});

	test("caps prompt box below ten lines when available height is smaller", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxPromptLines: () => 3,
		});

		for (const char of "abcdefghijklmnopqrstuvwxyz0123456789") modal.handleInput(char);
		const rendered = modal.render(20).join("\n");

		expect(rendered.split("\n").filter((line) => line.includes("New session:") || line.includes("│              "))).toHaveLength(3);
		expect(rendered).not.toContain("New session: abcdef");
		expect(rendered).toContain("9▌");
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

	test("detail view uses fixed modal height", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Fix auth tests", {
					source: "sdk-live",
					status: "running",
					assistantPreview: "Working",
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 12,
		});

		modal.handleInput("\u001b[C");

		expect(modal.render(90)).toHaveLength(12);
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
		expect(detail).toContain("running · tool: grep");
		expect(detail).toContain("Latest output preview");

		modal.handleInput("\u001b[D");

		expect(modal.render(90).join("\n")).toContain("New session:");
	});

	test("detail renders multiple transcript entries with labels", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Fix auth tests", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					activeTool: "grep",
					assistantPreview: "old one-line preview",
					transcript: [
						{ kind: "user", text: "Fix auth tests", updatedAt: 1 },
						{ kind: "assistant", text: "I will inspect the failures.", updatedAt: 2 },
						{ kind: "tool", title: "grep", status: "running", text: "pattern: auth", updatedAt: 3 },
						{ kind: "notice", text: "Queued follow-up", updatedAt: 4 },
						{ kind: "error", text: "Retry failed", updatedAt: 5 },
					],
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 18,
		});

		modal.handleInput("\u001b[C");
		const rendered = modal.render(90).join("\n");

		expect(rendered).toContain("You: Fix auth tests");
		expect(rendered).toContain("Assistant: I will inspect the failures.");
		expect(rendered).toContain("Tool grep running: pattern: auth");
		expect(rendered).toContain("Notice: Queued follow-up");
		expect(rendered).toContain("Error: Retry failed");
		expect(rendered).not.toContain("old one-line preview");
	});

	test("detail wraps long transcript text and keeps overlay invariants", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Wrap", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					transcript: [{ kind: "assistant", text: "abcdefghijklmnopqrstuvwxyz0123456789", updatedAt: 1 }],
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 12,
		});

		modal.handleInput("\u001b[C");
		const rendered = modal.render(30);
		const joined = rendered.join("\n");

		expect(joined).toContain("Assistant: abcdefghijklmno");
		expect(joined).toContain("           pqrstuvwxyz0123");
		expect(rendered).toHaveLength(12);
		expect(rendered.every((line) => !line.includes("\r"))).toBe(true);
		expect(new Set(rendered.map((line) => visibleWidth(line)))).toEqual(new Set([30]));
	});

	test("detail viewport shows bottom transcript lines by default", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Bottom", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					transcript: Array.from({ length: 10 }, (_, index) => ({ kind: "assistant" as const, text: `line ${index}`, updatedAt: index })),
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 10,
		});

		modal.handleInput("\u001b[C");
		const rendered = modal.render(80).join("\n");

		expect(rendered).not.toContain("line 0");
		expect(rendered).toContain("line 9");
	});

	test("detail up reveals earlier lines and end follows latest output", () => {
		let entries = Array.from({ length: 10 }, (_, index) => ({ kind: "assistant" as const, text: `line ${index}`, updatedAt: index }));
		let version = 1;
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Scroll", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					transcript: entries,
					transcriptVersion: version,
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 10,
		});

		modal.handleInput("\u001b[C");
		expect(modal.render(80).join("\n")).toContain("line 9");

		modal.handleInput("\u001b[A");
		let rendered = modal.render(80).join("\n");
		expect(rendered).toContain("line 8");
		expect(rendered).not.toContain("line 9");
		expect(rendered).toContain("End follow latest");

		entries = [...entries, { kind: "assistant" as const, text: "line 10", updatedAt: 10 }];
		version++;
		rendered = modal.render(80).join("\n");
		expect(rendered).toContain("line 8");
		expect(rendered).not.toContain("line 10");

		modal.handleInput("\u001b[F");
		rendered = modal.render(80).join("\n");
		expect(rendered).toContain("line 10");
		expect(rendered).toContain("↑ scroll");
	});

	test("detail at bottom follows incoming updates automatically", () => {
		let entries = Array.from({ length: 9 }, (_, index) => ({ kind: "assistant" as const, text: `line ${index}`, updatedAt: index }));
		let version = 1;
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [
				row("run", "Follow", {
					source: "sdk-live",
					status: "running",
					isStreaming: true,
					transcript: entries,
					transcriptVersion: version,
				}),
			],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
			maxHeightLines: () => 10,
		});

		modal.handleInput("\u001b[C");
		expect(modal.render(80).join("\n")).toContain("line 8");

		entries = [...entries, { kind: "assistant" as const, text: "line 9", updatedAt: 9 }];
		version++;
		const rendered = modal.render(80).join("\n");
		expect(rendered).toContain("line 9");
		expect(rendered).not.toContain("line 0");
	});

	test("printable keys in detail do not edit prompt", () => {
		const created: string[] = [];
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("run", "Prompt", { source: "sdk-live", status: "running", isStreaming: true })],
			onCreate: (prompt) => created.push(prompt),
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		modal.handleInput("\u001b[C");
		modal.handleInput("z");
		modal.handleInput("\u001b[D");
		modal.handleInput("\r");

		expect(created).toEqual([]);
	});

	test("detail falls back when transcript is empty", () => {
		const modal = new AgentsModalComponent({
			theme,
			getRows: () => [row("run", "Fallback", { source: "sdk-live", status: "running", isStreaming: true, promptPreview: "Prompt fallback" })],
			onCreate: () => {},
			onOpen: () => {},
			onAbort: noop,
			onClose: () => {},
		});

		modal.handleInput("\u001b[C");

		expect(modal.render(90).join("\n")).toContain("Prompt fallback");
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
