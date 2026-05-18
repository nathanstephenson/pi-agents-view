import { describe, expect, test } from "bun:test";
import { AgentsSessionRegistry } from "./registry.js";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

function session(overrides: Partial<SessionInfo> & Pick<SessionInfo, "path" | "id">): SessionInfo {
	return {
		cwd: "/repo",
		created: new Date("2026-01-01T00:00:00Z"),
		modified: new Date("2026-01-01T00:00:00Z"),
		messageCount: 0,
		firstMessage: "",
		allMessagesText: "",
		...overrides,
	};
}

describe("AgentsSessionRegistry", () => {
	test("shows the current Pi session before recent persisted sessions", async () => {
		const registry = new AgentsSessionRegistry({
			listSessions: async () => [
				session({ path: "/sessions/older.jsonl", id: "older", firstMessage: "Older prompt", modified: new Date("2026-01-01T00:00:00Z") }),
				session({ path: "/sessions/newer.jsonl", id: "newer", name: "Named spike", modified: new Date("2026-01-02T00:00:00Z") }),
			],
		});

		registry.refreshCurrent({ isIdle: () => true });
		await registry.refreshRecent("/repo");

		expect(registry.getRows().map((row) => row.title)).toEqual([
			"Current Pi session",
			"Named spike",
			"Older prompt",
		]);
		expect(registry.getRows().map((row) => row.source)).toEqual(["current-pi", "recent-file", "recent-file"]);
	});

	test("notifies subscribers and merges recent sessions by file path", async () => {
		let notifications = 0;
		const registry = new AgentsSessionRegistry({
			listSessions: async () => [session({ path: "/sessions/one.jsonl", id: "one" })],
		});
		const unsubscribe = registry.subscribe(() => notifications++);

		await registry.refreshRecent("/repo");
		await registry.refreshRecent("/repo");
		unsubscribe();
		await registry.refreshRecent("/repo");

		expect(registry.getRows().filter((row) => row.sessionFile === "/sessions/one.jsonl")).toHaveLength(1);
		expect(notifications).toBe(2);
	});
});
