# ADR-011 — A minimal in-house MCP server for the CLI driver

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** runtime / security
- **RFC:** waived — decided while building the runtime on 2026-10-30

## Context

The CLI driver runs `claude -p` as a subprocess, so Ork's tools (`ask_user`, and
the `permission` prompt that `--permission-prompt-tool` calls) must reach it
over MCP. The obvious choice was the official MCP SDK's streamable HTTP server.
Under Ork's strict TypeScript settings (`skipLibCheck: false`,
`exactOptionalPropertyTypes`, no DOM lib), its server types do not compile, and
it pulls in express, hono, and their dependency trees for four methods.

## Decision

Ork serves its tools with its own minimal MCP endpoint
([mcp-http.ts](../packages/runtime-claude/src/mcp-http.ts)):

- the streamable HTTP transport with plain JSON responses (no SSE stream, which
  the transport allows), implementing only `initialize`, `ping`, `tools/list`,
  and `tools/call`;
- tool arguments validated with the same Zod shapes the SDK driver uses, and
  their JSON Schemas generated from them;
- bound to `127.0.0.1` only, on a random port, behind a per-session random
  bearer token compared in constant time, with a 1 MiB request limit;
- one endpoint per session, closed when the session ends.

The Agent SDK driver keeps the SDK's in-process MCP server
(`createSdkMcpServer`), so the tool definitions are shared.

## Options considered

- **The MCP SDK server.** Complete, but its types fail Ork's strict build and it
  adds a large dependency tree to a tool that runs on users' machines.
- **Loosen the build** (`skipLibCheck: true`). Hides type errors everywhere to
  accommodate one dependency.
- **A stdio MCP server spawned by `claude`** that relays to Ork. A second
  process per session and an IPC channel to secure.
- **A minimal in-house endpoint** — chosen.

## Rationale

Four JSON-RPC methods are small enough to own, audit, and test fully; binding to
loopback with a bearer token keeps other local processes and web pages out.

## Consequences

- New MCP features Ork needs (for example resources or SSE notifications) are
  implemented here, against the protocol spec.
- The protocol version echoes the client's request; a breaking protocol change
  needs a look here.
- The MCP SDK stays installed as a peer dependency of the Agent SDK, and one
  type shim keeps its types compiling
  ([types/dom-shims.d.ts](../types/dom-shims.d.ts)).
