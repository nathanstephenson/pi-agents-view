# Agents View: simultaneous sessions plan

## Goal

Build an agents view that takes over the terminal UI, shows multiple running sessions with live updates, lets the user start a new session by typing a prompt, and lets the user open a selected running session into the normal Pi application view.

Navigation target:

- `↑` / `↓`: move selection in agents view session list
- `→`: open selected session in the normal Pi view
- `←`: return from an opened session to the agents/session list view
- typed prompt in agents view: create a new background session and start it

## Current repo state

- `src/index.ts` is a scaffold extension.
- It registers `--agents` and `/agents`.
- `openAgentsView(ctx)` currently uses `ctx.ui.custom(..., { overlay: true })` to show a right-side overlay with placeholder sections.

This is enough for a prototype menu, but not enough for the requested final experience. The final UX should be treated as requiring Pi core work, not only an extension.

## Relevant Pi APIs found

### TUI component APIs

Docs: `/home/nathan/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`

Useful APIs:

- `ctx.ui.custom<T>(factory, options?)`: render a focused custom component.
- `matchesKey(data, Key.up/down/left/right/enter/escape)`: keyboard handling.
- `Component.render(width)`, `handleInput(data)`, `invalidate()`.
- Built-ins from `@earendil-works/pi-tui`: `Container`, `Text`, `Input`, `Markdown`, truncation helpers.

Important limitation:

- Extension `ctx.ui.custom()` can overlay or temporarily replace the editor/custom prompt area. It does not appear to expose a public full-terminal takeover API.
- The current extension uses overlay mode, which conflicts with the desired model: agents view should become the whole application surface.

### Extension session-switch APIs

Docs/source:

- `docs/extensions.md`
- `dist/core/extensions/types.d.ts`

Available in command context:

- `ctx.newSession({ setup, withSession })`
- `ctx.switchSession(sessionPath, { withSession })`
- `ctx.fork(entryId, { withSession })`
- `ctx.waitForIdle()`

These APIs replace the active interactive Pi session. They are useful for opening a selected session into normal Pi view, but they do not create multiple simultaneous active sessions inside one interactive runtime.

### SDK session APIs

Docs/source:

- `examples/sdk/13-session-runtime.ts`
- `dist/core/agent-session.d.ts`
- `dist/core/session-manager.d.ts`

Useful APIs:

- `createAgentSession(...)` or `createAgentSessionRuntime(...)`
- `SessionManager.create(ctx.cwd)` for persisted background sessions
- `session.prompt(prompt)` to run a session
- `session.subscribe(event => ...)` for updates
- `session.sessionFile`, `session.sessionId`, `session.sessionName`, `session.isStreaming`
- `SessionManager.list(ctx.cwd)` / `SessionManager.listAll()` for persisted session metadata

This is the likely foundation for simultaneous background sessions.

## Key product/architecture decision

There are two implementation levels:

### Level 1: Extension-only prototype

Can build as a spike/prototype:

- Agents list component with arrow navigation.
- Prompt input at bottom.
- Background sessions started via SDK `createAgentSession()`.
- Live per-session status from `session.subscribe(...)`.
- `→` attempts to open a selected session by calling `ctx.switchSession(sessionFile)`.

This should not be considered final-acceptance capable for the requested UX.

Cannot fully guarantee:

- True whole-terminal takeover.
- Opening the exact same in-memory running session in normal Pi UI.
- Returning with `←` from normal Pi UI back to the still-live agents view.

This prototype may need to pause/keep background sessions running and switch to the session file, but Pi’s normal session replacement will likely create/rebind a separate runtime for that file rather than attach to the original in-memory `AgentSession` object.

### Level 2: Core Pi mode / first-class multiplexer

Needed for the requested final UX.

Add a first-class “agents mode” to Pi core, not just an extension overlay. This mode owns the top-level terminal surface and multiplexes multiple `AgentSessionRuntime`s.

Benefits:

- Agents view can truly replace the normal app view.
- Normal Pi app view can attach to an existing running runtime instead of reopening from disk.
- `←` can detach from the focused session and return to the session list without killing it.
- Shared lifecycle/disposal, keybindings, status, and rendering are controlled by core instead of extension hacks.

## Proposed target architecture

### 1. Session registry

Create an `AgentsSessionRegistry` owned by the agents mode/runtime.

Responsibilities:

- Maintain `Map<sessionId, ManagedAgentSession>`.
- Track metadata:
  - id
  - session file path
  - display name
  - prompt/first message preview
  - status: `queued | running | waiting | complete | error | aborted`
  - latest assistant text preview
  - latest tool call summary
  - pending queue count
  - created/updated timestamps
- Own subscriptions and cleanup.
- Persist/recover session list from session files plus active in-memory runtimes.

`ManagedAgentSession` shape:

```ts
interface ManagedAgentSession {
  id: string;
  runtime: AgentSessionRuntime;
  session: AgentSession;
  sessionFile?: string;
  status: SessionStatus;
  title: string;
  preview: string;
  lastEventAt: number;
  unsubscribe?: () => void;
}
```

### 2. Background session creation

From agents view prompt input:

1. User types prompt.
2. Agents mode creates a new persisted `SessionManager.create(cwd)`.
3. Create a new `AgentSessionRuntime` or `AgentSession` with the same services/model/settings as the main app.
4. Subscribe to events before prompting.
5. Add it to the registry immediately with `queued/running` status.
6. Call `session.prompt(prompt, { source: "extension" | "interactive" })` asynchronously.
7. Redraw the agents view on every relevant event.

### 3. Live updates

Map `AgentSessionEvent`s to list rows:

- `message_start`: mark running, initialize preview.
- `message_update` text delta: append/truncate preview.
- `tool_execution_start`: show active tool call.
- `tool_execution_end`: clear/update tool summary.
- `queue_update`: show queued count.
- `agent_end`: mark waiting/complete depending on queue/idle state.
- `session_info_changed`: update title.
- error/retry events: show retry/error state.

Keep the view lightweight: only preview the latest text/tool state in the list; full transcript belongs to normal Pi view.

### 4. Agents view UI

Replace the current placeholder in `src/index.ts` with a custom component, not `SelectList`.

Layout:

```text
┌ Agents ───────────────────────────────────────────────┐
│ 3 running · 1 waiting · cwd: /repo                     │
├───────────────────────────────────────────────────────┤
│ > ● Refactor auth                 running  tool: grep │
│   ◌ Write tests                   waiting             │
│   ✕ Fix build                     error               │
│                                                       │
├───────────────────────────────────────────────────────┤
│ New session: implement cache invalidation▌            │
│ ↑↓ select · → open · ← sessions · Enter create        │
└───────────────────────────────────────────────────────┘
```

Input behavior:

- Printable characters edit the prompt input.
- `Enter` creates a new session when prompt input is non-empty.
- `↑/↓` always changes selected session, even while prompt text is present. This matches the requested navigation contract; prompt cursor movement can use other bindings later if needed.
- `→` opens selected session.
- `←` is no-op while already in list view, or returns from detail panes if added later.

Use `Focusable` + `CURSOR_MARKER` if using custom inline input so IME/cursor placement works.

### 5. Opening a running session

Target behavior:

- `→` switches terminal from agents list to normal Pi session UI attached to the selected running runtime.
- Session continues streaming visibly in normal Pi view.
- `←` detaches and returns to agents list; session continues in background.

Implementation requirement in Pi core:

- Add an app-level view router, e.g. `agentsList` vs `sessionDetail(sessionId)`.
- Normal interactive renderer must be parameterized by active `AgentSessionRuntime`, not assume one global runtime forever.
- Switching views should rebind UI subscriptions/rendering to the selected runtime without disposing it.
- Keybinding layer should route `←` in session detail to agents mode before normal editor handling.

Extension-only fallback:

- On `→`, call `ctx.switchSession(sessionFile)` only after accepting the risk.
- Register a shortcut for left arrow or command like `/agents` to return.
- Accept that this may not attach to the exact same in-memory running session and may not preserve true simultaneous runtime semantics.
- Avoid opening a session file that is still being actively written by a background SDK runtime unless we have verified Pi's session persistence can tolerate that. Otherwise, mark this fallback as read-only/experimental or disable open-while-running in the prototype.

### 6. Returning to agents view

In final core design:

- `←` from session detail triggers `viewRouter.showAgentsList()`.
- Do not call `session_shutdown`; just detach UI from that runtime.
- Keep subscriptions for registry summaries active.

In extension fallback:

- Use `/agents` or a registered shortcut to reopen the overlay/component.
- This is not the desired final UX but can validate workflow.

## Implementation phases

### Phase 0: Confirm constraints

- Decide whether this repo is allowed to modify Pi core, or must remain extension-only.
- If extension-only, explicitly accept UX compromises and do not claim support for full-terminal takeover or true open-running-session attachment.
- If the requested final UX is the acceptance target, plan Pi core changes as mandatory.
- If core changes are allowed, move agents view from extension overlay to core mode.

### Phase 1: Extension prototype

- Replace placeholder `SelectList` with a custom `AgentsViewComponent`.
- Implement keyboard handling for `↑/↓/→/←/Enter`.
- Add prompt input line.
- Add in-memory session rows with mock state first.
- Typecheck.

### Phase 2: Background session registry

- Import SDK APIs from `@earendil-works/pi-coding-agent`.
- Create `AgentsSessionRegistry` module.
- Create persisted sessions with `SessionManager.create(ctx.cwd)`.
- Start prompts asynchronously.
- Subscribe and update row state.
- Redraw via `tui.requestRender()`.
- Dispose subscriptions on extension shutdown.

### Phase 3: Open selected session

- Prototype `→` with `ctx.switchSession(sessionFile)`.
- After switch, optionally use `withSession` to notify or send queued input if needed.
- Validate behavior while background SDK session is still running.
- Document mismatch if switch opens a separate runtime.

### Phase 4: Core full-screen mode

If final UX is required, implement in Pi core:

- Top-level agents mode flag, e.g. `pi --agents` starts `AgentsInteractiveMode`.
- Shared `AgentsSessionRegistry` with multiple runtimes.
- Full-screen agents list renderer.
- View router: list/detail.
- Attach/detach normal Pi renderer to selected runtime.
- Left-arrow return from detail to list.
- Clean shutdown of all managed runtimes.

### Phase 5: Polish and persistence

- Recover active/recent sessions from `SessionManager.list(ctx.cwd)`.
- Show persisted sessions separately from live sessions if useful.
- Session names via `pi.setSessionName()` or `SessionManager.appendSessionInfo()`.
- Add error states, retry visibility, abort controls later.
- Add tests for key handling and event-to-status reducer.

## Testing strategy

Unit tests:

- key handling reducer:
  - up/down clamps to list bounds
  - enter creates only with non-empty prompt
  - right emits open action for selected session
  - left returns from non-list pane
- event reducer:
  - message deltas update preview
  - tool events update active tool
  - queue/error/retry events set correct status

Integration/manual tests:

- `npm run typecheck`
- `pi -e . --agents`
- Create two sessions quickly; verify both stream/update.
- Stress concurrent persistence: two background sessions writing, plus session listing.
- If using extension fallback, try opening a running session and verify whether it attaches to the live runtime or creates a competing runtime over the same file.
- Open a running session; verify normal Pi view shows it.
- Return to agents list; verify other sessions continued.
- Shutdown while sessions run; verify disposal/abort behavior is sane.

## Main risks

1. **Full-screen takeover is not exposed to extensions**
   - Current public APIs are overlay/editor replacement oriented.
   - Mitigation: prototype in extension, final in Pi core.

2. **Opening a running in-memory session is not public extension API**
   - `switchSession(sessionPath)` replaces by file, not necessarily attaches to an existing runtime.
   - Mitigation: core view router over multiple `AgentSessionRuntime`s.

3. **Multiple runtimes may contend for tools/resources**
   - Concurrent bash/edit/write operations can conflict in one working tree.
   - Mitigation: display active tools clearly; later add per-session permissions/locking.

4. **Extension lifecycle can invalidate captured contexts**
   - Docs warn old contexts are stale after session replacement.
   - Mitigation: avoid captured `ctx` after `switchSession`; store plain metadata and runtime-owned objects carefully.

5. **Terminal key conflicts**
   - Left/right may conflict with editor cursor movement in normal Pi view.
   - Mitigation: only route bare `←` globally in agents detail mode; normal app mode outside agents should keep existing behavior.

## Recommendation

Build an extension-only prototype first only to validate session registry, live updates, and interaction model. Treat it as a spike, not the final implementation. For the stated final UX—agents view taking over the app, multiple simultaneous sessions, opening a running session as the normal Pi view, and returning with `←`—Pi core changes with a first-class agents/multiplexer mode are required.
