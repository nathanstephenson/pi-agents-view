import { describe, expect, test } from "bun:test";
import { openRecentRow } from "./index.js";
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

describe("opening recent sessions", () => {
	test("waits for the foreground session to be idle before switching", async () => {
		const calls: string[] = [];
		await openRecentRow(recent("/session.jsonl"), {
			ui: { notify: (message: string) => calls.push(`notify:${message}`) },
			waitForIdle: async () => calls.push("idle"),
			switchSession: async (path: string) => calls.push(`switch:${path}`),
		} as never);

		expect(calls).toEqual(["idle", "switch:/session.jsonl"]);
	});

	test("warns when a selected row has no session file", async () => {
		const calls: string[] = [];
		await openRecentRow(recent(undefined), {
			ui: { notify: (message: string, level: string) => calls.push(`${level}:${message}`) },
			waitForIdle: async () => calls.push("idle"),
			switchSession: async (path: string) => calls.push(`switch:${path}`),
		} as never);

		expect(calls).toEqual(["warning:No session file to open"]);
	});
});
