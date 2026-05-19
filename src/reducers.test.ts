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
	});

	test("tracks active tool lifecycle", () => {
		const subject = row();

		applySessionEvent(subject, { type: "tool_execution_start", toolName: "grep", args: {} } as never);
		expect(subject.status).toBe("running");
		expect(subject.activeTool).toBe("grep");
		expect(subject.isStreaming).toBe(true);

		applySessionEvent(subject, { type: "tool_execution_end", toolName: "grep", result: "", isError: false } as never);
		expect(subject.activeTool).toBeUndefined();
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

	test("updates title and queue preview from session events", () => {
		const subject = row();

		applySessionEvent(subject, { type: "session_info_changed", name: "Named background task" } as never);
		applySessionEvent(subject, { type: "queue_update", steering: ["urgent"], followUp: ["next"] } as never);

		expect(subject.title).toBe("Named background task");
		expect(subject.status).toBe("queued");
		expect(subject.assistantPreview).toContain("2 queued");
	});
});
