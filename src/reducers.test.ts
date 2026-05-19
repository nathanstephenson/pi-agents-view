import { describe, expect, test } from "bun:test";
import { applySessionEvent } from "./reducers.js";
import type { ManagedSessionRow } from "./types.js";

function row(): ManagedSessionRow {
	return {
		id: "session-1",
		source: "sdk-live",
		title: "Original title",
		status: "queued",
		updatedAt: 1,
	};
}

describe("applySessionEvent", () => {
	test("captures assistant text updates as a running preview", () => {
		const subject = row();

		applySessionEvent(subject, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "Hello from background" }] },
		} as never);

		expect(subject.status).toBe("running");
		expect(subject.isStreaming).toBe(true);
		expect(subject.assistantPreview).toContain("Hello from background");
		expect(subject.transcriptVersion).toBe(1);
		expect(subject.transcript).toMatchObject([{ kind: "assistant", text: "Hello from background" }]);
	});

	test("upserts assistant message updates by message id", () => {
		const subject = row();

		applySessionEvent(subject, { type: "message_start", message: { id: "a1", role: "assistant", content: "Hel" } } as never);
		applySessionEvent(subject, { type: "message_update", message: { id: "a1", role: "assistant", content: "Hello" } } as never);

		expect(subject.transcriptVersion).toBe(2);
		expect(subject.transcript).toHaveLength(1);
		expect(subject.transcript?.[0]).toMatchObject({ kind: "assistant", text: "Hello" });
	});

	test("keeps separate no-id assistant messages while upserting active message events", () => {
		const subject = row();

		applySessionEvent(subject, { type: "message_start", message: { role: "assistant", content: "Fir" } } as never);
		applySessionEvent(subject, { type: "message_update", message: { role: "assistant", content: "First" } } as never);
		applySessionEvent(subject, { type: "message_end", message: { role: "assistant", content: "First done" } } as never);
		applySessionEvent(subject, { type: "message_start", message: { role: "assistant", content: "Second" } } as never);

		expect(subject.transcript).toHaveLength(2);
		expect(subject.transcript?.map((entry) => entry.text)).toEqual(["First done", "Second"]);
	});

	test("clears no-id assistant state when message_end has no text", () => {
		const subject = row();

		applySessionEvent(subject, { type: "message_start", message: { role: "assistant", content: "First" } } as never);
		applySessionEvent(subject, { type: "message_end", message: { role: "assistant" } } as never);
		applySessionEvent(subject, { type: "message_update", message: { role: "assistant", content: "Second" } } as never);

		expect(subject.transcript).toHaveLength(2);
		expect(subject.transcript?.map((entry) => entry.text)).toEqual(["First", "Second"]);
	});

	test("tracks visible tool lifecycle details", () => {
		const subject = row();

		applySessionEvent(subject, { type: "tool_execution_start", toolName: "grep", args: { pattern: "needle" }, toolCallId: "tool-1" } as never);
		expect(subject.status).toBe("running");
		expect(subject.activeTool).toBe("grep");
		expect(subject.isStreaming).toBe(true);
		expect(subject.transcript?.[0]).toMatchObject({ kind: "tool", title: "grep", status: "running" });
		expect(subject.transcript?.[0]?.text).toContain("needle");

		applySessionEvent(subject, { type: "tool_execution_end", toolName: "grep", result: "found it", isError: false, toolCallId: "tool-1" } as never);
		expect(subject.activeTool).toBeUndefined();
		expect(subject.transcriptVersion).toBe(2);
		expect(subject.transcript).toMatchObject([{ kind: "tool", title: "grep", status: "complete", text: "found it" }]);
	});

	test("marks agent end as waiting and clears streaming state", () => {
		const subject = row();
		const runningStatus: typeof subject.status = "running";
		subject.status = runningStatus;
		subject.isStreaming = true;
		subject.activeTool = "bash";

		applySessionEvent(subject, { type: "agent_end", messages: [] } as never);

		expect((subject as ManagedSessionRow).status).toBe("waiting");
		expect(subject.isStreaming).toBe(false);
		expect(subject.activeTool).toBeUndefined();
	});

	test("updates title and shows queue notices from session events", () => {
		const subject = row();

		applySessionEvent(subject, { type: "session_info_changed", name: "Named background task" } as never);
		applySessionEvent(subject, { type: "queue_update", steering: ["urgent"], followUp: ["next"] } as never);

		expect(subject.title).toBe("Named background task");
		expect(subject.status).toBe("queued");
		expect(subject.assistantPreview).toContain("2 queued");
		expect(subject.transcript).toMatchObject([{ kind: "notice", text: "Queued steering: urgent\nQueued follow-up: next" }]);
	});

	test("shows retries and errors in transcript without throwing on circular values", () => {
		const subject = row();
		const circular: { self?: unknown } = {};
		circular.self = circular;

		applySessionEvent(subject, { type: "auto_retry_start", attempt: 2, maxAttempts: 3, errorMessage: "rate limited" } as never);
		applySessionEvent(subject, { type: "tool_execution_end", toolName: "bash", result: circular, isError: true } as never);

		expect(subject.transcript?.map((entry) => entry.kind)).toEqual(["error", "error"]);
		expect(subject.transcript?.map((entry) => entry.text).join("\n")).toContain("rate limited");
		expect(subject.transcript?.map((entry) => entry.text).join("\n")).toContain("[unserializable result]");
	});

	test("caps transcript entries while preserving the first user entry", () => {
		const subject = row();
		subject.transcript = [{ kind: "user", text: "Original prompt", createdAt: 1 }];
		subject.transcriptVersion = 1;

		for (let index = 0; index < 210; index++) {
			applySessionEvent(subject, {
				type: "message_update",
				message: { id: `message-${index}`, role: "assistant", content: `Assistant ${index}` },
			} as never);
		}

		expect(subject.transcript).toHaveLength(200);
		expect(subject.transcript?.[0]).toMatchObject({ kind: "user", text: "Original prompt" });
		expect(subject.transcript?.at(-1)).toMatchObject({ kind: "assistant", text: "Assistant 209" });
	});
});
