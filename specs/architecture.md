# Architecture

Status: **Built**: `@krapht/ork-integrations`, `@krapht/ork-schema`,
`@krapht/ork-core`, `@krapht/ork-runtime`, `@krapht/ork-nodes` and the CLI
`@krapht/ork` exist, and so do `@krapht/ork-server` with `ork ui`
([server](./server.md)) and `@krapht/ork-ui`, with its panels and the workflow
builder and the context inspector ([ui](./ui.md)). `schemaVersion` is still 1,
so `schema/` has no migration yet. Why:
[ADR-002](../decisions/ADR-002-typescript-from-source.md),
[ADR-003](../decisions/ADR-003-oxlint-oxfmt-and-boundaries.md),
[ADR-039](../decisions/ADR-039-local-server.md).

```
ork/
  packages/
    integrations/    registries: one adapter per CLI tool (gh, aws, shell) and agent driver (ADR-022)
    schema/          Zod schemas → JSON Schema; YAML load/save with stable formatting; migrations
    core/            graph compiler & validator, scheduler, context compiler, message bus,
                     decision queue, event store (SQLite + JSONL), worktree manager
    runtime/  AgentRuntime: adapters (strategies) + one session runner; claude-code (claude -p stream-json); command-code (cmd -p json); open-code (opencode run --format json)
    nodes/           built-in node-type registry (each: schema, defaults, execute(), UI metadata)
    server/          node:http JSON API + SSE streams, typed contract and client; loopback + token (ADR-039)
    cli/             `ork` bin (citty): init, validate, run, ps, logs, chat, decide, ui, doctor, context
    ui/              Vite + React + Base UI + dockview + containerized-state; an in-house graph (ADR-040)
  examples/          software-factory.ork.yaml, pr-review.ork.yaml, …
  docs/
```

- **Tooling:** Node 24 (runs the TypeScript sources directly), pnpm workspaces
  with supply-chain policies, tsdown for publishing, vitest, oxlint (type-aware)
  and oxfmt, and GitHub Actions CI.
- **Licence:** MIT.
- **Packages on npm:** only the CLI is published, as `@krapht/ork`, a tsdown
  bundle of the private `@krapht/ork-schema`, `-core`, `-runtime`, `-nodes` and
  `-server` packages ([release](../runbook/development/release.md)).
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
- **Integrations are adapters:** each CLI tool and agent driver is one adapter
  in `@krapht/ork-integrations`, listed in a registry that the schema, the tool
  executor, `ork doctor` and `ork run` read
  ([ADR-022](../decisions/ADR-022-integration-registry.md)). The dependency
  direction is
  `integrations <- schema <- core <- runtime, nodes <- server <- ui, cli`.
- **A driver is an adapter of strategies, run by one runner** (RFC-014):
  `@krapht/ork-runtime` registers a `CliAdapter` per driver id
  ([registry.ts](../packages/runtime/src/registry.ts)), made of small strategies
  ([adapter.ts](../packages/runtime/src/adapter.ts)): `Command` (program,
  arguments, stdin input if the tool takes it), `EventDecoder` (an output line
  to events), `McpWiring` (a `flag`, a `config-file` named by a variable, or a
  per-folder `lease`; released when the session ends), `PermissionPolicy`
  (`rules` or `callback`), `UsageReader` (dollars or tokens; how legs add up),
  `ContextLayers` (instruction files, skills and agents, and the variables that
  keep the machine's setup out) and an optional `HoldHook`. The session runner
  ([session-runner.ts](../packages/runtime/src/session-runner.ts)) does the rest
  once: Ork's MCP endpoint, the legs (one process each,
  [session-leg.ts](../packages/runtime/src/session-leg.ts)), holding a paused
  node's call (ADR-041), a message to a tool without stdin delivered by resuming
  the session in a next leg (only after a leg that ended in `success`; an error
  ends the session with it), Ork's `report` tool for a driver without
  `reportSchema` (the session ends with the report it accepted;
  [node report](./runtime/node-report.md)), and interrupt (also during the MCP
  wiring, before any process: the session then ends `interrupted` and starts
  none; [runtime](./runtime.md#the-drivers)).
- **Every adapter keeps one contract**
  ([contract.test.ts](../packages/runtime/test/contract/contract.test.ts)): one
  set of cases runs through the session runner against each entry of
  [entries.ts](../packages/runtime/test/contract/entries.ts), an adapter with a
  fake tool that replays its CLI's output (`claude-code`:
  [fake-claude.mjs](../packages/runtime/test/fixtures/fake-claude.mjs)). The
  cases: events normalized, a report that fits kept and one that breaks the
  schema rejected, a denied tool still denied, Ork's endpoint reached and then
  gone, usage counted (dollars only where the descriptor declares `price`), an
  interrupt ending the session, and a message sent mid-session arriving (at once
  with `midTurnMessages`, else at the next leg); on a driver without
  `reportSchema`, a report handed in through the `report` tool, refused once and
  then kept. A registered adapter with no entry fails the suite, so a new driver
  is an adapter, a fake and one entry, with no edit to the engine.
- **One entry point per package:** `packages/<name>/src/index.ts` only
  re-exports the package's public pieces, and other packages import only from
  it. No other module is named `index.ts`; logic lives in modules named for what
  they do (`pnpm lint`: `tools/lint/entry-points.ts`).

## Contents

- [Command Code](./architecture/command-code.md)
