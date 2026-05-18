import { describe, expect, test } from "bun:test";
import { AgentsSessionRegistry } from "./registry.js";
import type { AgentSessionEvent, SessionInfo } from "@earendil-works/pi-coding-agent";

type Listener = (event: AgentSessionEvent) => void;

class FakeSession {
	readonly sessionId = "sdk-1";
	readonly sessionFile = "/sessions/sdk-1.jsonl";
	isStreaming = false;
	promptCalls: Array<{ prompt: string; source?: string }> = [];
	listener: Listener | undefined;

	subscribe(listener: Listener): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	async prompt(prompt: string, options?: { source?: string }): Promise<void> {
		this.promptCalls.push({ prompt, source: options?.source });
		this.isStreaming = true;
		this.listener?.({ type: "agent_start" } as never);
	}

	abortCalls = 0;
	abortError: Error | undefined;

	async abort(): Promise<void> {
		this.abortCalls++;
		if (this.abortError) throw this.abortError;
		this.isStreaming = false;
	}

	dispose(): void {}
}

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

	test("starts a persistent background SDK session and updates from live events", async () => {
		const fake = new FakeSession();
		const notifications: string[] = [];
		const registry = new AgentsSessionRegistry({
			createSession: (async () => ({ session: fake as never, extensionsResult: { extensions: [], errors: [], runtime: undefined } as never })) as never,
			createSessionManager: (cwd) => ({ cwd, persisted: true }),
		});
		registry.subscribe(() => notifications.push(registry.getRows()[0]?.status ?? "none"));

		await registry.startBackgroundSession("Investigate websocket reconnect flakes", { cwd: "/repo" } as never);

		const row = registry.getRow("sdk-1");
		expect(fake.promptCalls).toEqual([{ prompt: "Investigate websocket reconnect flakes", source: "extension" }]);
		expect(row?.source).toBe("sdk-live");
		expect(row?.sessionFile).toBe("/sessions/sdk-1.jsonl");
		expect(row?.title).toBe("Investigate websocket reconnect flakes");
		expect(row?.status).toBe("running");
		expect(notifications.length).toBeGreaterThanOrEqual(2);

		fake.listener?.({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "I found the reconnect issue" }] },
		} as never);

		expect(registry.getRow("sdk-1")?.assistantPreview).toContain("reconnect issue");
	});

	test("aborts a live SDK session without disposing it", async () => {
		const fake = new FakeSession();
		const statuses: string[] = [];
		const registry = new AgentsSessionRegistry({
			createSession: (async () => ({ session: fake as never, extensionsResult: { extensions: [], errors: [], runtime: undefined } as never })) as never,
		});
		registry.subscribe(() => statuses.push(registry.getRow("sdk-1")?.status ?? "none"));

		await registry.startBackgroundSession("Stop me", { cwd: "/repo" } as never);
		const row = registry.getRow("sdk-1");
		if (!row) throw new Error("expected row");
		row.activeTool = "bash";
		row.isStreaming = true;
		fake.isStreaming = true;

		await registry.abortSession("sdk-1");

		expect(fake.abortCalls).toBe(1);
		expect(registry.getRow("sdk-1")?.status).toBe("aborted");
		expect(registry.getRow("sdk-1")?.isStreaming).toBe(false);
		expect(registry.getRow("sdk-1")?.activeTool).toBeUndefined();
		expect(statuses).toContain("aborting");
	});

	test("records abort errors on the row", async () => {
		const fake = new FakeSession();
		fake.abortError = new Error("cannot stop");
		const registry = new AgentsSessionRegistry({
			createSession: (async () => ({ session: fake as never, extensionsResult: { extensions: [], errors: [], runtime: undefined } as never })) as never,
		});

		await registry.startBackgroundSession("Stop me", { cwd: "/repo" } as never);
		fake.isStreaming = true;
		await registry.abortSession("sdk-1");

		expect(registry.getRow("sdk-1")?.status).toBe("error");
		expect(registry.getRow("sdk-1")?.errorMessage).toBe("cannot stop");
	});
});
