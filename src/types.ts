import type { AgentSession } from "@earendil-works/pi-coding-agent";

export type SessionRowStatus =
	| "current"
	| "running"
	| "waiting"
	| "queued"
	| "complete"
	| "error"
	| "aborting"
	| "aborted"
	| "recent";

export type SessionRowSource = "current-pi" | "sdk-live" | "recent-file";

export type TranscriptEntryKind = "user" | "assistant" | "tool" | "tool-result" | "notice" | "error";

export interface TranscriptEntry {
	id?: string;
	kind: TranscriptEntryKind;
	title?: string;
	text: string;
	status?: "running" | "complete" | "error";
	createdAt?: number;
	updatedAt?: number;
}

export interface ManagedSessionRow {
	id: string;
	source: SessionRowSource;
	sessionFile?: string;
	title: string;
	promptPreview?: string;
	assistantPreview?: string;
	activeTool?: string;
	status: SessionRowStatus;
	updatedAt: number;
	messageCount?: number;
	errorMessage?: string;
	isStreaming?: boolean;
	transcript?: TranscriptEntry[];
	transcriptVersion?: number;

	sdk?: {
		session: AgentSession;
		unsubscribe: () => void;
	};
}

export type RegistryListener = () => void;
