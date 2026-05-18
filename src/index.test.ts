import { describe, expect, test } from "bun:test";
import { openSessionRow } from "./index.js";
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
