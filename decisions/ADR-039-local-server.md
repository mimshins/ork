# ADR-039 — A local server that is one more client of the store, on `node:http`

- **Status:** Accepted; its guards paragraph (5) is superseded in part by
  [ADR-090](./ADR-090-ork-ui-signs-in-with-a-code.md)
- **Date:** 2026-11-02
- **Topic:** server / UI / security
- **RFC:** waived — the author chose these options over the others below
- **Builds on:** [ADR-024](./ADR-024-event-store.md) (the store is the source of
  truth, and each run has a socket as its fast path);
  [ADR-011](./ADR-011-in-house-mcp-server.md) (the in-house MCP endpoint, for
  the same type-checking reason)

## Context

Milestone 2 adds a browser UI (`ork ui`). Every panel needs a way in from the
browser: the runs and their events, live; the decisions to answer; stop, chat,
start and resume. The original plan had the server host the engine, with the CLI
talking to it when it runs. Milestone 1 changed that premise: every run is its
own process, the store is the one place every view reads, and `ork decide`,
`stop`, `chat`, `logs --follow` and `run --detach` already reach a run from
another process, without a server.

## Decision

1. **The server holds no run.** It is one more client of the store and the
   sockets, like `ork decide` in another terminal. It reads the store; it writes
   answers and commands as rows, then wakes the run on its socket; it starts and
   resumes runs as detached processes, exactly as `--detach` does. Closing the
   UI stops no run, and the CLI and the UI always see the same runs. The CLI
   never goes through the server.
2. **One server per machine**, on `127.0.0.1:4417` by default, serving every
   registered project. `~/.ork/ui.json` (mode 0600) records its port, pid, token
   and start time, so a second `ork ui` opens the running one.
3. **`node:http`, written in-house**, with no web framework. JSON in and out,
   and Server-Sent Events for the live streams.
4. **A typed contract instead of a framework's client.** The routes, their
   request schemas (Zod) and their response types are declared once in
   `@krapht/ork-server`. The server's handlers are checked against it, and a
   small typed `fetch` client built from it is exported for the UI. Both sides
   are TypeScript in this repository, so no code generation is needed.
5. **Guards** (the token-in-the-link and cookie part is superseded by
   [ADR-090](./ADR-090-ork-ui-signs-in-with-a-code.md)). Loopback only, with no
   option for another address. A random token per start: `ork ui` opens the page
   with it once, and the server swaps it for an `HttpOnly`, `SameSite=Strict`
   cookie and redirects; scripts may send it as a bearer token. It is compared
   in constant time. A `Host` that is not the server's loopback address gets 403
   (DNS rebinding); a write needs the server's own `Origin` and a JSON body
   (CSRF); no CORS headers are sent.

## Options considered

- **Host the engine in the server**, as first planned: a run would end with the
  UI, the UI's runs would be special, and there would be two ways to reach a
  run. Rejected by the author.
- **Hono with `@hono/node-server`** (both already installed, as dependencies of
  `@modelcontextprotocol/sdk`). A spike on 2026-11-02 found that Hono's core,
  its SSE helper and its typed client compile under Ork's strict settings (with
  a `BufferSource` shim), and bundle; but the Node adapter's only entry imports
  `hono/ws`, whose types use the DOM's generic `MessageEvent<T>`, which Node
  declares without a type parameter, so no shim can fix it.
- **Hono's core over an in-house `node:http` bridge** (about 60 lines, which the
  spike ran): keeps Hono's routing and typed client, adds a direct dependency.
  Rejected by the author in favour of no framework, with the typed client
  replaced by the contract in (4).
- **Patch `@hono/node-server`** to drop its websocket types: the patch would
  have to be redone on every upgrade.
- **WebSocket** instead of SSE and POST: the events only flow one way, SSE
  reconnects with `Last-Event-ID` on its own, and needs no package.
- **A server per project:** the store and the registered projects are already
  machine-wide.
- **OpenAPI and a generated client:** a generator and a generated file to keep
  in step, for a client and a server that already share a language.

## Rationale

A server that only reads the store and writes rows adds no second way to reach a
run, so nothing the CLI does changes, and a crashed or closed UI loses nothing.
The API is small (about fifteen routes), so `node:http` costs little code, adds
no runtime dependency, and keeps the type-checking settings that ADR-011 also
kept. Declaring the contract once gives the UI the same type safety a
framework's client would, without a framework.

## Consequences

- `@krapht/ork-server` depends only on the workspace packages and `zod`.
- The logic `ork decide`, `stop`, `chat`, `run --detach` and `resume --detach`
  share with the server moves from the CLI into `@krapht/ork-core`.
- The routing, body limits, SSE framing and cookie handling are Ork's own code,
  with tests for each guard.
- Anything on the machine that can read `~/.ork/ui.json` as the user can drive
  the server, as it could already drive `ork` itself.
