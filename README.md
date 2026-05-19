# pi-agents-view

Pi extension that adds an extension-only agents dashboard for background Pi SDK sessions.

## Usage

Inside Pi, run:

```text
/agents
```

`/agents` is the primary entrypoint. It opens a modal dashboard with:

- the current Pi session
- recent persisted sessions for the current working directory
- SDK-created background sessions started from the modal prompt
- live status, assistant preview, and active-tool summary for running sessions
- a detail view for running sessions
- abort controls for SDK sessions created by this extension

You can also start Pi with:

```bash
pi -e . --agents
```

The `--agents` flag does **not** auto-open the modal during startup because startup hooks do not provide the same command-capable context needed for creating/opening sessions safely. When the flag is present, the extension notifies you to run `/agents`.

## Modal controls

List view:

- `↑` / `↓`: select rows
- type printable text: edit the `New session:` prompt
- `Backspace`: edit prompt
- `Enter`: create a background session when the prompt is non-empty; otherwise open/inspect the selected row
- `→`: inspect a running SDK session, or open an idle/recent session
- `Esc`: close the modal

Detail view:

- running SDK sessions show their live transcript in the modal, without switching the main Pi UI into the session file
- `↑` / `↓`: scroll the transcript up or down
- `Home` / `End`: jump to the top or bottom of the transcript
- the detail view follows the latest transcript output while it is at the bottom; scrolling up pauses follow-latest until you scroll back down or press `End`
- `←`: return to list
- `a`: abort the selected SDK-created session
- `o`: open the selected session after it is idle
- `Esc`: close the modal

When the modal is closed and background SDK sessions are running, a widget appears below the editor:

```text
Agents: N running · /agents open
```

The widget is cleared when there are no running SDK sessions, while the modal is open, or when the Pi session shuts down.

## Session behavior

- Recent persisted sessions open with `ctx.waitForIdle()` followed by `ctx.switchSession(sessionFile)`.
- Running SDK sessions are inspected inside the modal; they are not opened in the main Pi UI while still running.
- Idle/completed/aborted SDK sessions are unsubscribed and disposed before switching into their session file.
- Extension shutdown removes registry UI listeners, clears status/widget UI, and disposes all SDK sessions owned by this extension to avoid orphaned runtimes.

## Tool policy and extension loading

Background sessions currently use the Pi SDK defaults for model/tools, matching normal local Pi behavior. That means background agents may have write-capable tools depending on the user's Pi configuration. Run multiple background jobs with care if they may edit the same working tree.

Extension recursion was inspected while implementing background sessions. SDK sessions are created with a `DefaultResourceLoader` configured with `noExtensions: true`, so background sessions do not recursively load this extension or register duplicate UI hooks.

## Development

```bash
bun install
bun test
bun run typecheck
```

Pi discovers the extension through `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Manual smoke tests

```bash
pi -e .
/agents
```

Verify:

- modal opens
- arrows select rows
- typing and backspace edit the prompt
- enter on a prompt starts a background SDK session
- rows update while the session runs
- closing the modal shows `Agents: N running · /agents open`
- reopening `/agents` keeps live rows available and clears the widget while open
- `→` inspects a running row
- `a` aborts a running row
- completed/aborted rows can be opened in normal Pi after the SDK runtime is disposed

Also verify startup flag behavior:

```bash
pi -e . --agents
```

Expected: Pi starts normally and notifies you to run `/agents`; the modal does not auto-open.
