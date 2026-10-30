# Architecture

Status: **Partial**: `@krapht/ork-integrations`, `@krapht/ork-schema`,
`@krapht/ork-core`, `@krapht/ork-runtime-claude`, `@krapht/ork-nodes` and the
CLI `@krapht/ork` exist; `@krapht/ork-server` and the UI are specified. Why:
[ADR-002](../decisions/ADR-002-typescript-from-source.md),
[ADR-003](../decisions/ADR-003-oxlint-oxfmt-and-boundaries.md).

```
ork/
  packages/
    integrations/    registries: one adapter per CLI tool (gh, aws, shell) and Claude driver (ADR-022)
    schema/          Zod schemas → JSON Schema; YAML load/save with stable formatting; migrations
    core/            graph compiler & validator, scheduler, context compiler, message bus,
                     decision queue, event store (SQLite + JSONL), worktree manager
    runtime-claude/  ClaudeRuntime interface + drivers: sdk (@anthropic-ai/claude-agent-sdk), cli (claude -p stream-json)
    nodes/           built-in node-type registry (each: schema, defaults, execute(), UI metadata)
    server/          Hono: REST + SSE event stream; serves built UI; local-only bind 127.0.0.1 + token
    cli/             `ork` bin (citty): init, validate, run, ps, logs, chat, decide, ui, doctor, context
    ui/              (M2) Vite + React + @xyflow/react + TanStack Query + zustand
  examples/          software-factory.ork.yaml, pr-review.ork.yaml, …
  docs/
```

- **Tooling:** Node 24 (runs the TypeScript sources directly), pnpm workspaces
  with supply-chain policies, tsdown for publishing, vitest, oxlint (type-aware)
  and oxfmt, and GitHub Actions CI.
- **Licence:** MIT.
- **Packages on npm:** only the CLI is published, as `@krapht/ork`, a tsdown
  bundle of the private `@krapht/ork-schema`, `-core`, `-runtime-claude`,
  `-nodes` and `-server` packages
  ([release](../runbook/development/release.md)).
- **Single process:** `ork run` hosts the engine in-process. `ork ui` starts the
  same engine together with the server. The CLI talks to a running server over
  HTTP if one is running, and otherwise runs the engine embedded.
- **Integrations are adapters:** each CLI tool and Claude driver is one adapter
  in `@krapht/ork-integrations`, listed in a registry that the schema, the tool
  executor, `ork doctor` and `ork run` read
  ([ADR-022](../decisions/ADR-022-integration-registry.md)). The dependency
  direction is
  `integrations <- schema <- core <- runtime-claude, nodes <- server <- cli`.
