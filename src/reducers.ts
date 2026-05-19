import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { applyTranscriptEvent } from "./transcript.js";
import type { ManagedSessionRow } from "./types.js";

const MAX_PREVIEW_CHARS = 2000;

export function applySessionEvent(row: ManagedSessionRow, event: AgentSessionEvent): void {
	const now = Date.now();
	row.updatedAt = now;
	applyTranscriptEvent(row, event, now);

	switch (event.type) {
		case "agent_start":
		case "turn_start":
			row.status = "running";
			row.isStreaming = true;
			break;
		case "message_update":
		case "message_start":
		case "message_end": {
			const text = getMessageText((event as { message?: unknown }).message);
			if (text) row.assistantPreview = capPreview(text);
			if (event.type !== "message_end") {
				row.status = "running";
				row.isStreaming = true;
			}
			break;
		}
		case "tool_execution_start":
		case "tool_execution_update":
			row.status = "running";
			row.isStreaming = true;
			row.activeTool = getToolName(event);
			break;
		case "tool_execution_end":
			row.activeTool = undefined;
			if ((event as { isError?: boolean }).isError) {
				row.errorMessage = stringify((event as { result?: unknown }).result);
			}
			break;
		case "queue_update": {
			const count = event.steering.length + event.followUp.length;
			if (count > 0) {
				row.status = "queued";
				row.assistantPreview = `${count} queued`;
			}
			break;
		}
		case "session_info_changed":
			if (event.name) row.title = event.name;
			break;
		case "auto_retry_start":
			row.status = "running";
			row.isStreaming = true;
			row.errorMessage = event.errorMessage;
			row.assistantPreview = `Retrying ${event.attempt}/${event.maxAttempts}…`;
			break;
		case "auto_retry_end":
			if (!event.success && event.finalError) {
				row.status = "error";
				row.errorMessage = event.finalError;
				row.isStreaming = false;
			}
			break;
		case "compaction_end":
			if (event.errorMessage) row.errorMessage = event.errorMessage;
			break;
		case "agent_end":
			row.isStreaming = false;
			row.activeTool = undefined;
			row.status = row.status === "aborted" ? "aborted" : "waiting";
			break;
	}
}

function getToolName(event: unknown): string | undefined {
	return typeof (event as { toolName?: unknown }).toolName === "string"
		? (event as { toolName: string }).toolName
		: undefined;
}

function getMessageText(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const role = (message as { role?: unknown }).role;
	if (role && role !== "assistant") return undefined;
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
				return (part as { text: string }).text;
			}
			return "";
		})
		.filter(Boolean);
	return parts.length > 0 ? parts.join("") : undefined;
}

function capPreview(text: string): string {
	return text.length > MAX_PREVIEW_CHARS ? text.slice(-MAX_PREVIEW_CHARS) : text;
}

function stringify(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	return value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value);
}
