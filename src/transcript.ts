import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ManagedSessionRow, TranscriptEntry } from "./types.js";

const MAX_TRANSCRIPT_ENTRIES = 200;
const MAX_TRANSCRIPT_TEXT_CHARS = 8000;
const MAX_TOOL_TEXT_CHARS = 4000;

type TranscriptState = ManagedSessionRow & { activeAssistantEntryId?: string; nextAssistantEntryIndex?: number };

export function initializePromptTranscript(prompt: string, now = Date.now()): TranscriptEntry[] {
	return [createTranscriptEntry("user", prompt, now)];
}

export function appendErrorTranscript(row: ManagedSessionRow, text: string, now = Date.now()): void {
	appendTranscriptEntry(row, createTranscriptEntry("error", text, now));
}

export function applyTranscriptEvent(row: ManagedSessionRow, event: AgentSessionEvent, now = Date.now()): boolean {
	const entry = transcriptEntryFromEvent(row as TranscriptState, event, now);
	if (!entry) return false;
	appendTranscriptEntry(row, entry);
	return true;
}

function transcriptEntryFromEvent(row: TranscriptState, event: AgentSessionEvent, now: number): TranscriptEntry | undefined {
	switch (event.type) {
		case "message_start":
		case "message_update":
		case "message_end": {
			const text = getMessageText((event as { message?: unknown }).message);
			if (!text) return undefined;
			return createTranscriptEntry("assistant", text, now, messageEntryId(row, event));
		}
		case "tool_execution_start":
			return createToolTranscriptEntry(event, now, "running", summarizeToolPayload("Args", (event as { args?: unknown }).args));
		case "tool_execution_update":
			return createToolTranscriptEntry(event, now, "running", summarizeToolPayload("Update", (event as { update?: unknown; result?: unknown }).update ?? (event as { result?: unknown }).result));
		case "tool_execution_end": {
			const isError = Boolean((event as { isError?: boolean }).isError);
			const result = summarizeToolResult((event as { result?: unknown }).result);
			return createToolTranscriptEntry(event, now, isError ? "error" : "complete", result, isError ? "error" : "tool");
		}
		case "queue_update": {
			const lines = [
				...event.steering.map((text) => `Queued steering: ${text}`),
				...event.followUp.map((text) => `Queued follow-up: ${text}`),
			];
			return lines.length > 0 ? createTranscriptEntry("notice", lines.join("\n"), now) : undefined;
		}
		case "auto_retry_start":
			return createTranscriptEntry("error", `Retrying ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`, now);
		case "auto_retry_end":
			if (!event.success && event.finalError) return createTranscriptEntry("error", event.finalError, now);
			return undefined;
		case "compaction_end":
			if (event.errorMessage) return createTranscriptEntry("error", event.errorMessage, now);
			return undefined;
		default:
			return undefined;
	}
}

function appendTranscriptEntry(row: ManagedSessionRow, entry: TranscriptEntry): void {
	const transcript = row.transcript ? [...row.transcript] : [];
	const existingIndex = entry.id ? transcript.findIndex((candidate) => candidate.id === entry.id) : -1;
	if (existingIndex >= 0) {
		transcript[existingIndex] = { ...transcript[existingIndex], ...entry, createdAt: transcript[existingIndex]?.createdAt };
	} else {
		transcript.push(entry);
	}
	row.transcript = capTranscript(transcript);
	row.transcriptVersion = (row.transcriptVersion ?? 0) + 1;
}

function capTranscript(entries: TranscriptEntry[]): TranscriptEntry[] {
	const capped = entries.map((entry) => ({ ...entry, text: capText(entry.text) }));
	if (capped.length <= MAX_TRANSCRIPT_ENTRIES) return capped;
	const first = capped[0]?.kind === "user" ? capped[0] : undefined;
	const tailLimit = first ? MAX_TRANSCRIPT_ENTRIES - 1 : MAX_TRANSCRIPT_ENTRIES;
	const tail = capped.slice(-tailLimit);
	return first && !tail.some((entry) => entry.id === first.id && entry.createdAt === first.createdAt) ? [first, ...tail] : tail;
}

function createTranscriptEntry(kind: TranscriptEntry["kind"], text: string, createdAt: number, id?: string): TranscriptEntry {
	return { id, kind, text: capText(text), createdAt };
}

function createToolTranscriptEntry(
	event: unknown,
	createdAt: number,
	status: NonNullable<TranscriptEntry["status"]>,
	text = "",
	kind: TranscriptEntry["kind"] = "tool",
): TranscriptEntry {
	const title = getToolName(event) ?? "Tool";
	return { ...createTranscriptEntry(kind, capText(text || `${title} ${status}`), createdAt, toolEntryId(event)), title, status };
}

function summarizeToolPayload(label: string, value: unknown): string | undefined {
	const text = summarizeToolResult(value);
	return text ? `${label}: ${text}` : undefined;
}

function summarizeToolResult(value: unknown): string | undefined {
	const text = stringify(value);
	if (!text) return undefined;
	return text.length > MAX_TOOL_TEXT_CHARS ? text.slice(0, MAX_TOOL_TEXT_CHARS) : text;
}

function capText(text: string): string {
	return text.length > MAX_TRANSCRIPT_TEXT_CHARS ? text.slice(0, MAX_TRANSCRIPT_TEXT_CHARS) : text;
}

function messageEntryId(row: TranscriptState, event: AgentSessionEvent): string {
	const message = (event as { message?: { id?: unknown } }).message;
	if (typeof message?.id === "string") return `message:${message.id}`;
	if (event.type === "message_start" || !row.activeAssistantEntryId) {
		row.nextAssistantEntryIndex = (row.nextAssistantEntryIndex ?? 0) + 1;
		row.activeAssistantEntryId = `assistant:${row.nextAssistantEntryIndex}`;
	}
	const id = row.activeAssistantEntryId;
	if (event.type === "message_end") row.activeAssistantEntryId = undefined;
	return id;
}

function toolEntryId(event: unknown): string | undefined {
	const id = (event as { toolCallId?: unknown; id?: unknown }).toolCallId ?? (event as { id?: unknown }).id;
	return typeof id === "string" ? `tool:${id}` : undefined;
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

function stringify(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (value instanceof Error) return value.message;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return "[unserializable result]";
	}
}
