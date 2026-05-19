# Extension-only agents modal implementation plan

## Purpose

Implement a practical extension-only agents view for Pi:

- Modal/overlay dashboard showing:
  - current Pi session
  - SDK-created live background sessions
  - waiting/idle background sessions
  - recent persisted sessions
- Prompt input in the modal to start a new background SDK `AgentSession`.
- Live row updates while background sessions run.
- Inspect running sessions inside the modal.
- Cancel/abort sessions created by the modal.
- Open idle/completed/recent sessions in normal Pi via `ctx.switchSession(sessionFile)`.

This plan intentionally does **not** promise true full-app takeover or attaching normal Pi UI to an already-running SDK session. Those require Pi core support.

## Current baseline

Repo files:

- `src/index.ts`: current extension scaffold.
  - registers `--agents`
  - registers `/agents`
  - opens placeholder `SelectList` overlay
- `README.md`: documents scaffold.
- `package.json`: TypeScript extension package using Pi peer deps.

Replace the placeholder `SelectList` with a custom modal component and a session registry.

## Final extension UX

### Modal list view

```text
┌ Agents ─────────────────────────────────────────────────────┐
│ 2 running · 1 waiting · 5 recent        cwd: /repo           │
├─────────────────────────────────────────────────────────────┤
│ > ● Fix auth tests                 running    tool: grep     │
│   ● Refactor CLI parser            running    writing…       │
│   ◌ Update README                  waiting                   │
│   ○ Yesterday: theme spike         recent     12 msgs        │
├─────────────────────────────────────────────────────────────┤
│ New session: investigate flaky websocket reconnect▌          │
│ ↑↓ select · Enter create · → inspect/open · Esc close        │
└─────────────────────────────────────────────────────────────┘
```

### Modal detail view for running sessions

```text
┌ Fix auth tests ──────────────────────────────────────────────┐
│ Status: running                                              │
│ Tool: grep src/auth                                          │
├─────────────────────────────────────────────────────────────┤
│ Latest output preview...                                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ a abort · o open when idle · ← back · Esc close              │
└─────────────────────────────────────────────────────────────┘
```

### Key behavior

List view:

- `↑/↓`: select rows.
- printable chars: append to `New session:` input.
- `Backspace`: edit prompt input.
- `Enter`: create background session if prompt is non-empty.
- `→`: inspect selected running live session, or open idle/recent session.
- `Esc`: close modal.

Detail view:

- `←`: return to list.
- `a`: abort selected SDK-created session.
- `o`: open selected session if idle and has `sessionFile`.
- `Esc`: close modal.

When modal is closed, keep a small widget/status:

```text
Agents: 2 running · /agents open
```

Only mention a keyboard shortcut after it is actually registered and verified.

## Important constraints

### What is feasible

- Use `ctx.ui.custom(..., { overlay: true })` for modal.
- Use a custom component with `handleInput` and `render`.
- Create independent SDK `AgentSession`s in the background.
- Subscribe to SDK session events and update modal rows.
- Abort SDK sessions owned by this extension.
- Open idle/completed/recent persisted sessions via `ctx.switchSession(sessionFile)` only after the SDK session is confirmed idle and flushed/disposed.

### What is not feasible extension-only

- Full terminal takeover.
- Attach Pi's normal transcript/editor/tool renderer to an SDK-created running session.
- Open a running SDK session as the same in-memory runtime.
- Safely use `ctx.switchSession` on a file still being actively written by a background SDK session.

Therefore:

- Running SDK sessions are inspected in modal.
- Opening into normal Pi is allowed only when idle/completed by default.
- Add no experimental open-while-running path unless explicitly requested later.

## Suggested file structure

Small version can stay single-file, but handoff implementation should split files:

```text
src/
  index.ts                 # extension registration + lifecycle
  registry.ts              # session registry and SDK session ownership
  modal.ts                 # AgentsModalComponent
  reducers.ts              # AgentSessionEvent -> row state
  render.ts                # row/detail rendering helpers
  types.ts                 # shared types
```

If the agent wants a smaller first patch, implement in `src/index.ts` first, then refactor.

## Types

Create `src/types.ts`:

```ts
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

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

  sdk?: {
    session: AgentSession;
    unsubscribe: () => void;
  };
}

export type RegistryListener = () => void;
```

Adjust imports if `AgentSession`/`AgentSessionEvent` type export names differ in installed Pi package.

## Registry design

Create `src/registry.ts`.

Responsibilities:

- Own live SDK sessions created by the modal.
- Load/merge recent sessions from `SessionManager.list(ctx.cwd)`.
- Add current Pi session row from `ctx.sessionManager`.
- Expose sorted rows for modal.
- Notify listeners when rows change.
- Abort/dispose live sessions on demand or extension shutdown.

API shape:

```ts
export class AgentsSessionRegistry {
  subscribe(listener: RegistryListener): () => void;
  getRows(): ManagedSessionRow[];
  getRow(id: string): ManagedSessionRow | undefined;

  refreshCurrent(ctx: ExtensionCommandContext | ExtensionContext): void;
  refreshRecent(cwd: string): Promise<void>;

  startBackgroundSession(prompt: string, ctx: ExtensionCommandContext): Promise<void>;
  abortSession(id: string): void;
  disposeSession(id: string): void;
  disposeAll(): void;
}
```

### Row ordering

Sort rows by:

1. current Pi session
2. live running sessions
3. queued/waiting SDK sessions
4. error/aborted SDK sessions
5. recent files
6. newest `updatedAt` within groups

### Recent session merge

`SessionManager.list(ctx.cwd)` returns recent files. Merge by `sessionFile`:

- If live row has same `sessionFile`, keep live row.
- Otherwise add `recent-file` row.

## Starting background sessions

Use SDK APIs from `@earendil-works/pi-coding-agent`:

```ts
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
```

Before implementing this slice, inspect `createAgentSession` options in the installed package. Specifically confirm whether SDK sessions auto-load extensions/resources. Avoid recursively loading this agents extension into every background session if possible. If the public SDK has an option to provide controlled services/resource loader/extensions, use it. If not, document observed behavior and ensure background sessions do not open their own agents modals or register duplicate UI behavior.

Pseudo-code:

```ts
async startBackgroundSession(prompt: string, ctx: ExtensionCommandContext) {
  const sessionManager = SessionManager.create(ctx.cwd);

  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    sessionManager,
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
  });

  const id = session.sessionId;
  const row = addRow({
    id,
    source: "sdk-live",
    sessionFile: session.sessionFile,
    title: titleFromPrompt(prompt),
    promptPreview: prompt,
    status: "queued",
    updatedAt: Date.now(),
    isStreaming: false,
  });

  const unsubscribe = session.subscribe((event) => {
    applySessionEvent(row, event);
    notify();
  });
  row.sdk = { session, unsubscribe };

  notify();

  void session.prompt(prompt, { source: "extension" }).catch((error) => {
    row.status = "error";
    row.errorMessage = error instanceof Error ? error.message : String(error);
    row.isStreaming = false;
    row.updatedAt = Date.now();
    notify();
  });
}
```

Notes:

- If `createAgentSession` return shape differs, inspect installed SDK examples.
- If `model`/`modelRegistry` are not accepted options, remove them and use SDK defaults.
- Start with persisted `SessionManager.create(ctx.cwd)` so idle sessions can later be opened by file.

## Event reducer

Create `src/reducers.ts`.

Map SDK events conservatively. Exact event shapes may vary; implement with type guards and robust fallbacks.

Required first step for this slice: inspect `AgentSessionEvent` type definitions and run one temporary event logger against a simple prompt to capture actual event names/shapes. Then implement the reducer from observed events.

Desired behavior:

- On text delta/update:
  - `status = "running"`
  - append/truncate `assistantPreview`
  - `isStreaming = true`
- On tool start:
  - `status = "running"`
  - set `activeTool`
- On tool end:
  - clear or summarize `activeTool`
- On queue update:
  - show queued count in preview or status.
- On session info changed:
  - update title.
- On agent/message end:
  - if no queued work and not streaming, set `waiting` or `complete`.
- On error/retry:
  - set `errorMessage` or retry preview.

Pseudo-code:

```ts
export function applySessionEvent(row: ManagedSessionRow, event: AgentSessionEvent): void {
  row.updatedAt = Date.now();

  switch (event.type) {
    case "message_update":
      row.status = "running";
      row.isStreaming = true;
      appendPreviewIfTextDelta(row, event);
      break;
    case "tool_execution_start":
      row.status = "running";
      row.isStreaming = true;
      row.activeTool = getToolName(event);
      break;
    case "tool_execution_end":
      row.activeTool = undefined;
      break;
    case "session_info_changed":
      row.title = event.name ?? row.title;
      break;
    case "agent_end":
      row.isStreaming = false;
      row.activeTool = undefined;
      row.status = row.status === "aborted" ? "aborted" : "waiting";
      break;
  }
}
```

Use `truncateToWidth` during rendering, not in stored state, except cap previews to e.g. 2000 chars to avoid memory growth.

## Abort/cancel behavior

Registry method:

```ts
async abortSession(id: string) {
  const row = this.rows.get(id);
  if (!row?.sdk) return;
  if (!row.sdk.session.isStreaming) return;

  row.status = "aborting";
  row.updatedAt = Date.now();
  this.notify();

  try {
    await row.sdk.session.abort();
    row.status = "aborted";
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
```

Caveats:

- Abort should stop the current turn but keep session file/object usable.
- External subprocess/tool cancellation depends on tool implementation.
- After abort settles and `session.isStreaming === false`, the row should be idle/openable if it has a `sessionFile`.
- Do not enable open while `status === "aborting"`.

Do **not** call `dispose()` for normal abort. Use `dispose()` only when removing/cleanup.

## Opening sessions

Implement in modal action handler, not inside component directly. Component emits actions; `openAgentsView` handles async operations with `ctx`.

Rules:

- `recent-file`: open with `ctx.waitForIdle(); ctx.switchSession(path)`.
- `sdk-live` and `status` is `running`/`queued`: show modal detail, do not `switchSession`.
- `sdk-live` and confirmed idle/complete/aborted/error with `sessionFile`:
  1. verify `row.sdk.session.isStreaming === false`
  2. unsubscribe SDK event listener
  3. `session.dispose()` to release background runtime and flush/close resources
  4. `await ctx.waitForIdle()` for current foreground Pi session
  5. `await ctx.switchSession(sessionFile)`

Pseudo-code:

```ts
async function openRow(row: ManagedSessionRow, ctx: ExtensionCommandContext) {
  if (!row.sessionFile) {
    ctx.ui.notify("No session file to open", "warning");
    return;
  }

  if (row.source === "sdk-live" && (row.isStreaming || row.sdk?.session.isStreaming)) {
    ctx.ui.notify("Session is running; inspect or abort it first", "warning");
    return;
  }

  if (row.status === "aborting") {
    ctx.ui.notify("Session is still aborting; wait until it is idle", "warning");
    return;
  }

  if (row.sdk) {
    row.sdk.unsubscribe();
    row.sdk.session.dispose();
  }

  await ctx.waitForIdle();
  await ctx.switchSession(row.sessionFile);
}
```

Because `ctx.switchSession` replaces current session/runtime, expect code after switch to be running in old closure. Avoid using stale `ctx` afterward.

## Modal component

Create `src/modal.ts`.

Component should be mostly synchronous and dumb:

- receives `getRows()` callback
- receives callbacks for actions:
  - `onCreate(prompt)`
  - `onOpen(rowId)`
  - `onAbort(rowId)`
  - `onClose()`
- owns local UI state:
  - selected index
  - prompt text
  - mode: `"list" | "detail"`
  - detail row id

Suggested constructor:

```ts
export class AgentsModalComponent implements Component, Focusable {
  constructor(options: {
    theme: Theme;
    getRows: () => ManagedSessionRow[];
    onCreate: (prompt: string) => void;
    onOpen: (rowId: string) => void;
    onAbort: (rowId: string) => void;
    onClose: () => void;
  }) {}
}
```

### Focusable/cursor

Implement `Focusable` and use `CURSOR_MARKER` for prompt cursor if practical:

```ts
import { CURSOR_MARKER, type Focusable } from "@earendil-works/pi-tui";
```

If this slows the first pass, render a visible block cursor manually and add `Focusable` later.

### Rendering

Use utilities:

```ts
import { matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
```

Ensure every rendered line is `<= width` visible cells.

Render rows manually rather than using `SelectList`, because prompt input and `→/←/a/o` semantics are custom.

### Input handling

Pseudo-code:

```ts
handleInput(data: string): void {
  if (this.mode === "detail") return this.handleDetailInput(data);

  if (matchesKey(data, Key.up)) selectPrevious();
  else if (matchesKey(data, Key.down)) selectNext();
  else if (matchesKey(data, Key.right)) onOpen(selectedRow.id);
  else if (matchesKey(data, Key.enter)) {
    const prompt = this.prompt.trim();
    if (prompt) {
      this.prompt = "";
      onCreate(prompt);
    } else {
      onOpen(selectedRow.id);
    }
  } else if (matchesKey(data, Key.escape)) onClose();
  else if (matchesKey(data, Key.backspace)) deletePromptChar();
  else if (isPrintable(data)) appendPrompt(data);

  this.invalidate();
}
```

For running rows, `onOpen` can either enter detail mode inside component or call parent; simplest: component enters detail mode if selected row `isStreaming`, otherwise parent opens by file.

Better: component can call `onOpen(rowId)`, parent decides. If parent wants detail, expose method or callback result. Simpler first pass: component itself enters detail for `row.isStreaming`; parent only handles open when idle.

## Extension registration

Update `src/index.ts`:

- imports registry/modal.
- create singleton registry in extension factory.
- `openAgentsView(ctx)` should require `ExtensionCommandContext`, not only `ExtensionContext`, because opening/session creation needs command APIs.
- register `/agents` command.
- optionally register shortcut later, e.g. `ctrl+alt+a`, if supported and tested.
- on `session_start`:
  - set status
  - registry.refreshCurrent(ctx)
  - bind widget/status listeners for this fresh context
  - set widget if there are background sessions
  - for MVP, do **not** auto-open the modal from `--agents` unless a command-capable context path is confirmed. Instead, set status/widget telling user to run `/agents`.
- on `session_shutdown`:
  - unbind widget/status listeners for that context
  - clear status/widget
  - consider whether to dispose all SDK sessions. For safety in initial implementation, dispose all.

Potential type adjustment:

Current `openAgentsView(ctx: ExtensionContext)` should become:

```ts
async function openAgentsView(ctx: ExtensionCommandContext, registry: AgentsSessionRegistry): Promise<void>
```

The `session_start` event only has `ExtensionContext`, not command context. If `--agents` opening needs command APIs, either:

1. Keep startup modal read-only/no creation/open from `session_start`, or
2. Do not auto-open on `session_start`; show status and ask user to run `/agents`, or
3. Check if context type includes command methods at runtime, but avoid unsafe assumptions.

MVP decision: keep `/agents` as primary. `--agents` should only set status/widget or print a notification instructing the user to run `/agents`, unless implementation confirms `session_start` can safely obtain command-capable actions. Do not ship a startup modal with half-enabled controls.

## Widget/status

Registry listener should update widget/status when modal closed:

```ts
function updateWidget(ctx: ExtensionContext) {
  const rows = registry.getRows();
  const running = rows.filter(r => r.source === "sdk-live" && r.isStreaming).length;
  if (running > 0) {
    ctx.ui.setWidget("agents-view", [`Agents: ${running} running · /agents open`], { placement: "belowEditor" });
  } else {
    ctx.ui.setWidget("agents-view", undefined);
  }
}
```

Need latest `ctx` from `session_start`/command; store carefully and clear on shutdown. Registry UI listeners must be rebound on every `session_start` and removed on `session_shutdown`. Do not use stale contexts after `ctx.switchSession`.

## Testing plan

### Typecheck

```bash
bun run typecheck
```

### Manual smoke tests

```bash
pi -e .
/agents
```

Verify:

- modal opens
- arrows select rows
- typing edits prompt
- backspace works
- enter on prompt starts background session
- modal updates while session runs
- close modal; widget shows running count
- reopen modal; live row still present
- inspect running row with `→`
- abort with `a`
- after idle, open with `o` or `→`

### Reducer tests if test infra exists

No test framework currently configured. If adding tests is too much, keep reducer pure and manually verify.

Test cases to cover manually or with future tests:

- message delta updates preview
- tool start/end updates activeTool
- agent end clears streaming
- abort sets aborted and clears tool
- recent merge avoids duplicate live/recent rows
- opening running row is blocked
- opening idle row disposes SDK session before `switchSession`

## Implementation slices

### Slice 1: Modal shell, fake rows

Goal: prove UI/key handling.

- Add `types.ts`, `modal.ts`.
- Replace current `SelectList` overlay with `AgentsModalComponent`.
- Use fake rows/current session row.
- Implement prompt editing and navigation.
- `Enter` just notifies prompt.

Acceptance:

- `/agents` opens modal.
- `↑/↓`, typing, backspace, `Esc` work.
- Typecheck passes.

### Slice 2: Recent sessions

Goal: useful modal without SDK sessions.

- Add `registry.ts` with current/recent rows.
- Use `SessionManager.list(ctx.cwd)`.
- `→` on recent row calls `ctx.waitForIdle(); ctx.switchSession(path)`.

Acceptance:

- modal shows current/recent sessions.
- recent session opens in normal Pi.

### Slice 3: SDK background sessions

Goal: start real background sessions from modal prompt.

- Implement `startBackgroundSession`.
- Subscribe to events.
- Add reducer.
- Update modal via registry listener + `tui.requestRender()`.

Acceptance:

- entering prompt starts new row.
- row moves to running.
- preview/tool/status update.

### Slice 4: Detail + abort

Goal: control running jobs.

- `→` on running row opens modal detail.
- `a` aborts SDK session.
- detail shows latest preview/tool/status.

Acceptance:

- abort stops streaming row.
- row becomes aborted/waiting and no active tool.

### Slice 5: Open idle SDK sessions

Goal: hand off completed/cancelled sessions to normal Pi.

- For idle SDK row with session file:
  - unsubscribe
  - dispose SDK session
  - `ctx.waitForIdle()`
  - `ctx.switchSession(path)`

Acceptance:

- completed/aborted background session opens as normal Pi session.
- running session open is blocked with warning.

## Tool policy for MVP

Background SDK sessions may default to powerful tools such as `bash`, `edit`, and `write`. This can conflict with foreground work or other background sessions.

MVP decision: start with SDK defaults only if that matches normal Pi behavior and is acceptable for local use. If the SDK supports `tools` or `initialActiveToolNames`, consider a safer first slice with read-only tools (`read`, `grep`, `find`, `ls`) until UI cancellation/status is proven. Document whichever policy is implemented in `README.md`.

## Known risks

1. **SDK option mismatch**
   - `createAgentSession` options may not accept all desired fields.
   - Start minimal: `cwd` + `sessionManager`.

2. **Model/settings mismatch**
   - Background sessions may not exactly match current foreground config.
   - Use `ctx.model` if supported; otherwise document default behavior.

3. **Extension reload/shutdown**
   - Running SDK sessions may be lost/disposed on reload.
   - Initial implementation should dispose all on shutdown to avoid orphan processes.

4. **Concurrent file edits/tools**
   - Background agents can edit same working tree as foreground.
   - Initial UI should make running sessions obvious. Later add permissions/tool restrictions.

5. **Opening after abort**
   - Abort may not instantly kill all subprocesses.
   - Wait until `session.isStreaming === false` before enabling open.

6. **Background extension recursion**
   - SDK-created sessions may load extensions/resources including this extension.
   - Confirm behavior before enabling background sessions broadly.

7. **Stale ctx after switchSession**
   - Do not continue using old command context after switching.

## Definition of done

Extension-only MVP is done when:

- `/agents` opens a modal dashboard.
- User can type a prompt and start a background SDK session.
- Multiple background sessions can run simultaneously and show live status rows.
- User can inspect a running session in modal.
- User can abort a running SDK session from modal.
- User can open idle/completed/aborted sessions in normal Pi via `switchSession` after SDK runtime is disposed.
- Running or aborting sessions are not opened via `switchSession` by default.
- Background SDK extension-loading behavior has been inspected and documented.
- `bun run typecheck` passes.
