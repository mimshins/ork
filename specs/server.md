# The local server

Status: **Built** ([server](../packages/server/src/server.ts),
[contract](../packages/server/src/contract.ts),
[client](../packages/server/src/client.ts),
[guards](../packages/server/src/guards.ts),
[`ork ui`](../packages/cli/src/commands/ui.ts),
[its supervisor](../packages/cli/src/browser/supervise.ts),
[tests](../packages/server/test/),
[end-to-end](../packages/cli/test/ui.test.ts)). It serves the built UI
([assets](../packages/server/src/assets.ts)), or a placeholder page when there
is none, as in a checkout that hasn't built it; the UI is in
[its spec](./ui.md). Decided in [ADR-039](../decisions/ADR-039-local-server.md)
and [ADR-040](../decisions/ADR-040-ui-stack.md).

`@krapht/ork-server` is the way into Ork from a browser: a JSON API with live
event streams, on loopback only. `ork ui` starts it and opens it.

## Contents

- [What it is, and ork ui](./server/what-it-is-and-ork-ui.md)
  - [What it is](./server/what-it-is-and-ork-ui.md#what-it-is)
  - [ork ui](./server/what-it-is-and-ork-ui.md#ork-ui)
- [API](./server/api.md)
- [Streams, the contract and security](./server/streams-contract-and-security.md)
  - [Streams](./server/streams-contract-and-security.md#streams)
  - [The contract and the typed client](./server/streams-contract-and-security.md#the-contract-and-the-typed-client)
  - [Security](./server/streams-contract-and-security.md#security)
