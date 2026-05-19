import {
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
	createAgentSession,
	getAgentDir,
	type CreateAgentSessionResult,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ResourceLoader,
	type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { applySessionEvent } from "./reducers.js";
import { appendErrorTranscript, initializePromptTranscript } from "./transcript.js";
import type { ManagedSessionRow, RegistryListener, SessionRowStatus } from "./types.js";

interface RegistryOptions {
	listSessions?: (cwd: string) => Promise<SessionInfo[]>;
	createSession?: typeof createAgentSession;
	createSessionManager?: (cwd: string) => unknown;
}

export class AgentsSessionRegistry {
	private readonly rows = new Map<string, ManagedSessionRow>();
	private readonly listeners = new Set<RegistryListener>();
	private readonly listSessions: (cwd: string) => Promise<SessionInfo[]>;
	private readonly createSession: typeof createAgentSession;
	private readonly createSessionManager: (cwd: string) => unknown;

	constructor(options: RegistryOptions = {}) {
		this.listSessions = options.listSessions ?? ((cwd) => SessionManager.list(cwd));
		this.createSession = options.createSession ?? createAgentSession;
		this.createSessionManager = options.createSessionManager ?? ((cwd) => SessionManager.create(cwd));
	}

	subscribe(listener: RegistryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getRows(): ManagedSessionRow[] {
		return Array.from(this.rows.values()).sort(compareRows);
	}

	getRow(id: string): ManagedSessionRow | undefined {
		return this.rows.get(id);
	}

	refreshCurrent(ctx: Pick<ExtensionContext, "isIdle">): void {
		const isIdle = ctx.isIdle();
		this.rows.set("current", {
			id: "current",
			source: "current-pi",
			title: "Current Pi session",
			status: isIdle ? "current" : "running",
			updatedAt: Date.now(),
			isStreaming: !isIdle,
		});
		this.notify();
	}

	async refreshRecent(cwd: string): Promise<void> {
		const sessions = await this.listSessions(cwd);
		const liveSessionFiles = new Set(
			Array.from(this.rows.values())
				.filter((row) => row.source === "sdk-live" && row.sessionFile)
				.map((row) => row.sessionFile as string),
		);

		for (const row of Array.from(this.rows.values())) {
			if (row.source === "recent-file") this.rows.delete(row.id);
		}

		for (const info of sessions) {
			if (liveSessionFiles.has(info.path)) continue;
			const id = `recent:${info.path}`;
			this.rows.set(id, {
				id,
				source: "recent-file",
				sessionFile: info.path,
				title: recentTitle(info),
				promptPreview: info.firstMessage || undefined,
				status: "recent",
				updatedAt: info.modified.getTime(),
				messageCount: info.messageCount,
			});
		}

		this.notify();
	}

	disposeAll(): void {
		for (const row of this.rows.values()) {
			if (!row.sdk) continue;
			row.sdk.unsubscribe();
			row.sdk.session.dispose();
			row.sdk = undefined;
			row.isStreaming = false;
			row.activeTool = undefined;
			if (row.status === "running" || row.status === "queued" || row.status === "aborting") row.status = "aborted";
		}
		this.notify();
	}

	async abortSession(id: string): Promise<void> {
		const row = this.rows.get(id);
		if (!row?.sdk || row.sdk.session.isStreaming === false) return;

		row.status = "aborting";
		row.updatedAt = Date.now();
		this.notify();

		try {
			await row.sdk.session.abort();
			row.status = "aborted";
			row.errorMessage = undefined;
		} catch (error) {
			row.status = "error";
			row.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			row.isStreaming = row.sdk.session.isStreaming;
			row.activeTool = undefined;
			row.updatedAt = Date.now();
			this.notify();
		}
	}

	async startBackgroundSession(prompt: string, ctx: Pick<ExtensionCommandContext, "cwd" | "model" | "modelRegistry">): Promise<void> {
		const sessionManager = this.createSessionManager(ctx.cwd);
		const resourceLoader = await createNoExtensionsResourceLoader(ctx.cwd);
		const result = (await this.createSession({
			cwd: ctx.cwd,
			sessionManager: sessionManager as never,
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			resourceLoader,
		})) as CreateAgentSessionResult;
		const { session } = result;
		const now = Date.now();
		const row: ManagedSessionRow = {
			id: session.sessionId,
			source: "sdk-live",
			sessionFile: session.sessionFile,
			title: titleFromPrompt(prompt),
			promptPreview: prompt,
			status: "queued",
			updatedAt: now,
			isStreaming: session.isStreaming,
			transcript: initializePromptTranscript(prompt, now),
			transcriptVersion: 1,
		};
		const unsubscribe = session.subscribe((event) => {
			applySessionEvent(row, event);
			if (row.status === "waiting" || row.status === "complete" || row.status === "aborted" || row.status === "error") {
				row.isStreaming = false;
			} else {
				row.isStreaming = session.isStreaming || row.isStreaming;
			}
			this.notify();
		});
		row.sdk = { session, unsubscribe };
		this.rows.set(row.id, row);
		this.notify();

		void session.prompt(prompt, { source: "extension" }).catch((error: unknown) => {
			row.status = "error";
			row.errorMessage = error instanceof Error ? error.message : String(error);
			appendErrorTranscript(row, row.errorMessage);
			row.isStreaming = false;
			row.activeTool = undefined;
			row.updatedAt = Date.now();
			this.notify();
		});
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function recentTitle(info: SessionInfo): string {
	return info.name || info.firstMessage || info.id || "Recent session";
}

function titleFromPrompt(prompt: string): string {
	const firstLine = prompt.trim().split(/\r?\n/, 1)[0] || "Background session";
	return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

async function createNoExtensionsResourceLoader(cwd: string): Promise<ResourceLoader> {
	const agentDir = getAgentDir();
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.create(cwd, agentDir),
		noExtensions: true,
	});
	await loader.reload();
	return loader;
}

function compareRows(left: ManagedSessionRow, right: ManagedSessionRow): number {
	const groupDelta = rowGroup(left) - rowGroup(right);
	if (groupDelta !== 0) return groupDelta;
	return right.updatedAt - left.updatedAt;
}

function rowGroup(row: ManagedSessionRow): number {
	if (row.source === "current-pi") return 0;
	if (row.source === "sdk-live" && (row.status === "running" || row.isStreaming)) return 1;
	if (row.source === "sdk-live" && isWaitingStatus(row.status)) return 2;
	if (row.source === "sdk-live" && isDoneStatus(row.status)) return 3;
	if (row.source === "recent-file") return 4;
	return 5;
}

function isWaitingStatus(status: SessionRowStatus): boolean {
	return status === "waiting" || status === "queued";
}

function isDoneStatus(status: SessionRowStatus): boolean {
	return status === "error" || status === "aborted" || status === "complete";
}
