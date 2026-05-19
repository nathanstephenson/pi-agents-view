import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ManagedSessionRow, TranscriptEntry } from "./types.js";

const MAX_TRANSCRIPT_ENTRIES = 200;
const MAX_TRANSCRIPT_TEXT_CHARS = 8000;

export function initializePromptTranscript(prompt: string, now = Date.now()): TranscriptEntry[] {
	return [createTranscriptEntry("user", prompt, now)];
}

export function appendErrorTranscript(row: ManagedSessionRow, text: string, now = Date.now()): void {
	appendTranscriptEntry(row, createTranscriptEntry("error", text, now));
}

export function applyTranscriptEvent(row: ManagedSessionRow, event: AgentSessionEvent, now = Date.now()): boolean {
	const entry = transcriptEntryFromEvent(event, now);
	if (!entry) return false;
	appendTranscriptEntry(row, entry);
	return true;
}

function transcriptEntryFromEvent(event: AgentSessionEvent, now: number): TranscriptEntry | undefined {
	switch (event.type) {
		case "message_start":
		case "message_update":
		case "message_end": {
			const text = getMessageText((event as { message?: unknown }).message);
			if (!text) return undefined;
			return createTranscriptEntry("assistant", text, now, messageEntryId(event));
		}
		case "tool_execution_start":
		case "tool_execution_update":
			return createTranscriptEntry("tool", getToolName(event) ?? "Tool", now, toolEntryId(event));
		case "tool_execution_end": {
			const name = getToolName(event) ?? "Tool";
			const result = stringify((event as { result?: unknown }).result);
			const suffix = (event as { isError?: boolean }).isError ? ` failed${result ? `: ${result}` : ""}` : " finished";
			return createTranscriptEntry((event as { isError?: boolean }).isError ? "error" : "tool", `${name}${suffix}`, now, toolEntryId(event));
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
		transcript[existingIndex] = { ...transcript[existingIndex], ...entry };
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

function capText(text: string): string {
	return text.length > MAX_TRANSCRIPT_TEXT_CHARS ? text.slice(0, MAX_TRANSCRIPT_TEXT_CHARS) : text;
}

function messageEntryId(event: unknown): string {
	const message = (event as { message?: { id?: unknown } }).message;
	return typeof message?.id === "string" ? `message:${message.id}` : "assistant:latest";
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
	return value instanceof Error ? value.message : typeof value === "string" ? value : JSON.stringify(value);
}
