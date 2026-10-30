# ADR-005 — One runtime port, two Claude drivers

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** runtime
- **RFC:** waived — decided in design review on 2026-10-30

## Context

Every Claude node runs a Claude Code session. Two ways exist to drive one: the
Claude Agent SDK in-process, or the headless `claude -p` CLI as a subprocess.
The SDK gives programmatic control (in-process tools, a permission callback,
hooks) but, per [ADR-004](./ADR-004-no-credentials.md), needs an API key or a
cloud provider. The CLI uses the user's own login. The engine must not care
which one a node uses.

## Decision

1. **A port in the engine.** `@krapht/ork-core` defines `ClaudeRuntime`:
   `start(spec, human)` returns a session with normalized events, `send`
   (delivered between turns), and `interrupt`
   ([types.ts](../packages/core/src/runtime/types.ts)). The engine depends only
   on the port; tests use a fake.
2. **Two drivers** in `@krapht/ork-runtime-claude`:
   - the Agent SDK driver ([sdk.ts](../packages/runtime-claude/src/sdk.ts)):
     streaming input, `canUseTool` for permissions, Ork's tools as an in-process
     MCP server;
   - the CLI driver ([cli.ts](../packages/runtime-claude/src/cli.ts)):
     `claude -p` with stream-json in and out, Ork's tools and permission prompt
     served over a local MCP endpoint
     ([ADR-011](./ADR-011-in-house-mcp-server.md)).
3. **One normalizer.** Both drivers emit the same message JSON (the SDK's
   messages are the CLI's stream-json lines), so one function maps them to Ork's
   events ([normalize.ts](../packages/runtime-claude/src/normalize.ts)).
4. **Per node.** A node (or the workflow's defaults) picks `driver: sdk | cli`.

## Options considered

- **Agent SDK only.** Cleanest engineering; leaves users without an API key
  unable to run anything.
- **CLI only.** Works with any login; loses the in-process callback and makes
  every tool a network hop.
- **The raw Messages API with Ork's own agent loop.** Most control, and a
  re-implementation of Claude Code.
- **One port, both drivers** — chosen by the maintainer.

## Rationale

The port keeps the engine testable without any account and lets each user pick
the driver their credentials allow. Sharing the normalizer keeps the two drivers
from drifting apart.

## Consequences

- Every driver feature needs an equivalent on the other driver (permissions,
  tools, structured output, resume) or a documented gap in
  [specs/runtime.md](../specs/runtime.md).
- The CLI driver is tested end to end against a stand-in `claude`
  ([fake-claude.mjs](../packages/runtime-claude/test/fixtures/fake-claude.mjs)),
  so CI needs no account.
