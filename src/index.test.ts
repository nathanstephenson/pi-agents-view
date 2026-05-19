import { describe, expect, test } from "bun:test";
import { bindAgentsWidget, openSessionRow, runningSdkRowCount } from "./index.js";
import type { ManagedSessionRow } from "./types.js";

function recent(sessionFile?: string): ManagedSessionRow {
	return {
		id: "recent:/session.jsonl",
		source: "recent-file",
		sessionFile,
		title: "Recent",
		status: "recent",
		updatedAt: 1,
	};
}

describe("agents widget lifecycle", () => {
	test("shows running sdk count only while the modal is closed", () => {
		let listener: (() => void) | undefined;
		const rows: ManagedSessionRow[] = [
			{ id: "current", source: "current-pi", title: "Current", status: "current", updatedAt: 1 },
			{ id: "running", source: "sdk-live", title: "Running", status: "running", isStreaming: true, updatedAt: 2 },
		];
		const widgetCalls: unknown[] = [];
		const binding = bindAgentsWidget(
			{ ui: { setWidget: (...args: unknown[]) => widgetCalls.push(args) } } as never,
			{
				getRows: () => rows,
				subscribe: (callback: () => void) => {
					listener = callback;
					return () => {
						listener = undefined;
					};
				},
			},
		);

		expect(widgetCalls.at(-1)).toEqual(["agents-view", ["Agents: 1 running · /agents open"], { placement: "belowEditor" }]);

		binding.setModalOpen(true);
		expect(widgetCalls.at(-1)).toEqual(["agents-view", undefined]);

		binding.setModalOpen(false);
		expect(widgetCalls.at(-1)).toEqual(["agents-view", ["Agents: 1 running · /agents open"], { placement: "belowEditor" }]);

		rows[1].status = "waiting";
		rows[1].isStreaming = false;
		listener?.();
		expect(widgetCalls.at(-1)).toEqual(["agents-view", undefined]);

		binding.unsubscribe();
		expect(listener).toBeUndefined();
	});

	test("counts only running sdk rows", () => {
		expect(
			runningSdkRowCount({
				getRows: () => [
					{ id: "current", source: "current-pi", title: "Current", status: "running", updatedAt: 1 },
					{ id: "running", source: "sdk-live", title: "Running", status: "running", updatedAt: 2 },
					{ id: "waiting", source: "sdk-live", title: "Waiting", status: "waiting", updatedAt: 3 },
					{ id: "recent", source: "recent-file", title: "Recent", status: "recent", updatedAt: 4 },
				],
			}),
		).toBe(1);
	});
});

describe("opening session rows", () => {
	test("waits for the foreground session to be idle before switching recent files", async () => {
		const calls: string[] = [];
		await openSessionRow(recent("/session.jsonl"), {
			ui: { notify: (message: string) => calls.push(`notify:${message}`) },
			waitForIdle: async () => calls.push("idle"),
			switchSession: async (path: string) => calls.push(`switch:${path}`),
		} as never);

		expect(calls).toEqual(["idle", "switch:/session.jsonl"]);
	});

	test("warns when a selected row has no session file", async () => {
		const calls: string[] = [];
		await openSessionRow(recent(undefined), {
			ui: { notify: (message: string, level: string) => calls.push(`${level}:${message}`) },
			waitForIdle: async () => calls.push("idle"),
			switchSession: async (path: string) => calls.push(`switch:${path}`),
		} as never);

		expect(calls).toEqual(["warning:No session file to open"]);
	});

	test("blocks running sdk rows", async () => {
		const calls: string[] = [];
		await openSessionRow(
			{
				...recent("/live.jsonl"),
				source: "sdk-live",
				status: "running",
				isStreaming: true,
			},
			{
				ui: { notify: (message: string, level: string) => calls.push(`${level}:${message}`) },
				waitForIdle: async () => calls.push("idle"),
				switchSession: async (path: string) => calls.push(`switch:${path}`),
			} as never,
		);

		expect(calls).toEqual(["warning:Session is running; inspect or abort it first"]);
	});

	test("disposes idle sdk rows before opening them", async () => {
		const calls: string[] = [];
		await openSessionRow(
			{
				...recent("/idle.jsonl"),
				source: "sdk-live",
				status: "complete",
				isStreaming: false,
				sdk: {
					session: { isStreaming: false, dispose: () => calls.push("dispose") } as never,
					unsubscribe: () => calls.push("unsubscribe"),
				},
			},
			{
				ui: { notify: (message: string, level: string) => calls.push(`${level}:${message}`) },
				waitForIdle: async () => calls.push("idle"),
				switchSession: async (path: string) => calls.push(`switch:${path}`),
			} as never,
		);

		expect(calls).toEqual(["unsubscribe", "dispose", "idle", "switch:/idle.jsonl"]);
	});
});
