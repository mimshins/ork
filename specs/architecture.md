# Architecture

Status: **Partial**: `@krapht/ork-integrations`, `@krapht/ork-schema`,
`@krapht/ork-core`, `@krapht/ork-runtime-claude`, `@krapht/ork-nodes` and the
CLI `@krapht/ork` exist, and so do `@krapht/ork-server` with `ork ui`
([server](./server.md)) and `@krapht/ork-ui`, with its panels and the workflow
builder and the context inspector ([ui](./ui.md)). Why:
[ADR-002](../decisions/ADR-002-typescript-from-source.md),
[ADR-003](../decisions/ADR-003-oxlint-oxfmt-and-boundaries.md),
[ADR-039](../decisions/ADR-039-local-server.md).

```
ork/
  packages/
    integrations/    registries: one adapter per CLI tool (gh, aws, shell) and Claude driver (ADR-022)
    schema/          Zod schemas → JSON Schema; YAML load/save with stable formatting; migrations
    core/            graph compiler & validator, scheduler, context compiler, message bus,
                     decision queue, event store (SQLite + JSONL), worktree manager
    runtime-claude/  ClaudeRuntime interface + drivers: sdk (@anthropic-ai/claude-agent-sdk), cli (claude -p stream-json)
    nodes/           built-in node-type registry (each: schema, defaults, execute(), UI metadata)
    server/          node:http JSON API + SSE streams, typed contract and client; loopback + token (ADR-039)
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
- **A process per run:** `ork run` hosts the engine in-process, in the
  foreground or detached. The store (`~/.ork/state.db`) is the one place every
  view reads, and each run's socket is the fast path to it
  ([ADR-024](../decisions/ADR-024-event-store.md)): other processes reach a run
  by writing rows and waking it.
- **The server is one more client:** `ork ui` starts the local server, which
  reads the store, writes answers and commands as rows, and starts runs as
  detached processes; it runs nothing itself, and the CLI never goes through it
  ([server](./server.md), [ADR-039](../decisions/ADR-039-local-server.md)).
  `ork ui` supervises it in a child process, so the page can restart it onto a
  newly installed `ork`
  ([ADR-060](../decisions/ADR-060-ork-ui-supervises-its-server.md)).
- **Integrations are adapters:** each CLI tool and Claude driver is one adapter
  in `@krapht/ork-integrations`, listed in a registry that the schema, the tool
  executor, `ork doctor` and `ork run` read
  ([ADR-022](../decisions/ADR-022-integration-registry.md)). The dependency
  direction is
  `integrations <- schema <- core <- runtime-claude, nodes <- server <- ui, cli`.
- **One entry point per package:** `packages/<name>/src/index.ts` only
  re-exports the package's public pieces, and other packages import only from
  it. No other module is named `index.ts`; logic lives in modules named for what
  they do (`pnpm lint`: `tools/lint/entry-points.ts`).
