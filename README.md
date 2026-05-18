# pi-agents-view

Pi extension for an agents view, accessible with:

```bash
pi -e . --agents
```

or inside Pi:

```text
/agents
```

## Current state

This repo contains the initial extension package scaffold:

- `pi.registerFlag("agents", ...)` for `pi --agents`
- `pi.registerCommand("agents", ...)` for `/agents`
- A TUI overlay placeholder for Agents / Chains / Runs

## Development

```bash
npm install
npm run typecheck
pi -e . --agents
```

Pi discovers the extension through `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

## Research notes

Relevant Pi docs/examples used while scaffolding:

- `docs/extensions.md` — extension entrypoint, commands, flags, UI APIs
- `docs/tui.md` — custom TUI component and overlay patterns
- `docs/packages.md` — distributable Pi package manifest
- `examples/extensions/plan-mode/index.ts` — boolean flag pattern
- `examples/extensions/preset.ts` — custom `SelectList` command UI
- `examples/extensions/commands.ts` — slash command pattern
