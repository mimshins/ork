# ADR-113 — Ork's tools reach `omp` as host tools, not through a plugin

- **Status:** Accepted
- **Date:** 2026-11-21
- **Topic:** runtime
- **RFC:** waived: the maintainer decided it directly, from RFC-027's open
  question 8
  ([RFC-027](../rfcs/archived/RFC-027-long-lived-protocol-drivers.md), which
  stays Active); the options considered are below
- **Amends:** [ADR-105](./ADR-105-omp-driver.md)

## Context

[ADR-105](./ADR-105-omp-driver.md) gave an `omp` leg Ork's tools through a
private plugin folder: `--plugin-dir`, an MCP server entry in the plugin's
`.mcp.json` with Ork's bearer token as a literal, and two environment variables
that made a start fail when the server was not ready.
[ADR-108](./ADR-108-duplex-session-client.md) moved `omp` to `omp --mode rpc` on
a two-way client and left the plugin route as it was, with host tools over
`set_host_tools` named as a later change. RFC-027's spike measured that
protocol: `set_host_tools` answers `{toolNames}`, a `host_tool_call` frame
carries `id`, `toolCallId`, `toolName` and `arguments`, and a `host_tool_result`
with `content` completes it.

## Decision

All by the maintainer, 2026-11-21. Changing ADR-105's wiring is hard to reverse
once a real `omp` run depends on it; the code and its tests are small.

- **Ork's tools are host tools, and the plugin route is gone.** On every leg (a
  resumed or forked one included) the codec writes `set_host_tools` before the
  first `prompt`, with one entry per Ork tool the session is bound to. The
  runner runs a `host_tool_call` in its own process and writes the
  `host_tool_result`. The private folder has no `plugin/` and no `.mcp.json`;
  the arguments have no `--plugin-dir`; the environment has no
  `OMP_MCP_REQUIRE_READY` or `OMP_MCP_TIMEOUT_MS`. `claude-plugins` joins the
  providers the overlay turns off, so a user's Claude plugins' servers stay out
  of the session.
- **No MCP fallback.** If `omp` rejects `set_host_tools`, the leg ends failed
  with "omp refused the session's start: …". A second route would keep the token
  in two files and show the model two names for each tool.
- **Ork's HTTP server stays for the hold endpoint only.** An adapter that
  declares `hostTools` gets the server with no tools (a `tools/list` is empty);
  the token is in `hold.json` only (0600, in a 0700 folder, removed with the
  session).
- **The model sees `ork_<tool>`;** Ork's own name stays `mcp__ork__<tool>`. The
  decoder and the guard map one to the other, so a node's rules and `ork logs`
  read as on every driver, and a name that starts with `mcp__` is a tool Ork
  does not know.
- **Built and tested on the fake `omp`; the rest is measured at the gate run.**
  The request's `tools` field, the result's `isError`, whether the guard's
  `tool_call` fires for a host tool, a call timeout, `host_tool_cancel` and
  `loadMode` are not measured and are recorded as limits
  ([L534 to L537](../specs/gaps/omp-limits.md)). Until the guard is known to
  fire, the overlay's per-tool `deny` is the wall. `omp` stays `proven: false`,
  so no run takes it meanwhile.

Contract: [the `omp` driver](../specs/runtime/omp.md),
[its wiring](../specs/runtime/omp-wiring.md) and
[the two-way client](../specs/runtime/duplex-client.md#what-the-client-does).

## Options considered

Keep the plugin beside host tools (rejected by the maintainer: two routes, the
token in two files, two names); host tools only (chosen); host tools with an MCP
fallback if `omp` rejects them (rejected: the fallback is the route the change
removes); a paid spike on a real `omp` before building (not chosen: the fake is
the practice for this driver, and the gate run measures).

## Rationale

The rpc client already owns a pipe to the child it spawned, so a tool call costs
a codec change instead of a second mechanism: nothing crosses a socket, no tool
body or result is on HTTP, and the token no longer sits in a plugin file. The
runner serves the tools in process, as it binds them for every other driver.

## Consequences

- Every `omp` node depends on host tools working on a real `omp`: a timeout on a
  long `ask_user`, no `tool_call` for the guard, or a different `isError` shape
  would affect all of them until fixed. The gate run measures these. _Update
  2026-11-21:_ it did: a long `ask_user` stayed open (2 minutes 29 seconds), the
  guard saw Ork's host tools, and the request shapes were accepted; what `omp`
  reads from a failed result is still unmeasured
  ([the gate run](../specs/runtime/omp-gate.md)).
- A tool added to Ork needs an `ork_<tool>` entry in the overlay, as it needed
  its plugin name before ([L478](../specs/gaps/omp-limits.md)).
- ADR-105's plugin decision is amended; its other decisions stand.
