import { SessionManager, type ExtensionContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import type { ManagedSessionRow, RegistryListener, SessionRowStatus } from "./types.js";

interface RegistryOptions {
	listSessions?: (cwd: string) => Promise<SessionInfo[]>;
}

export class AgentsSessionRegistry {
	private readonly rows = new Map<string, ManagedSessionRow>();
	private readonly listeners = new Set<RegistryListener>();
	private readonly listSessions: (cwd: string) => Promise<SessionInfo[]>;

	constructor(options: RegistryOptions = {}) {
		this.listSessions = options.listSessions ?? ((cwd) => SessionManager.list(cwd));
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

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function recentTitle(info: SessionInfo): string {
	return info.name || info.firstMessage || info.id || "Recent session";
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
