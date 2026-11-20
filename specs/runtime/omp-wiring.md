# Ork's tools and the private folder

_Part of [The `omp` driver](./omp.md)._

## Ork's tools and the private folder

`kind: "config-file"` wiring. Per session Ork writes a private folder outside
the checkout (mode 0700, files 0600,
[secret-file.ts](../../packages/runtime/src/secret-file.ts)), removed when the
session ends, after a failure or a write that threw part-way, and swept after a
crash:

| File          | Holds                                                                 |
| ------------- | --------------------------------------------------------------------- |
| `overlay.yml` | the settings overlay (`--config`)                                     |
| `guard.mjs`   | the guard, loaded with `--trusted-extension`                          |
| `hold.json`   | the hold URL and the token, only when the session can be held         |
| `stopped`     | written on a stop ([pausing](./omp-rules.md#pausing-and-heavy-slots)) |

- **The token** is in `hold.json` only: never in an argument, the leg's
  environment, an event, a log, the guard's source or the checkout. The guard
  holds it in memory inside `omp`. Any process of the same user can read the
  file; the guard refuses `omp`'s own file tools on the folder but cannot fence
  a shell. The runner's HTTP server answers `/hold` and offers no tools on `omp`
  (a `tools/list` there is empty), so the token opens the hold endpoint only. A
  host-tools driver has no `/mcp` endpoint, only `/hold`, so the contract
  harness and tests that reach the server must accept `/hold`. The fake `omp`
  writes its session file atomically (temp file, then rename): a plain write let
  a forked leg read a half-written file, which made a resume test flaky; the
  runner was not at fault.
- **Ork's tools** reach the model as host tools
  ([ADR-113](../../decisions/ADR-113-omp-host-tools.md)): on every leg the codec
  writes `set_host_tools` before the first `prompt` (a resumed or forked leg has
  them again) with one entry per Ork tool the session is bound to (`name`
  `ork_<tool>`, `description`, `parameters` as the tool's JSON Schema). `omp`
  answers each call with a `host_tool_call` frame, which the runner runs in
  process and answers with a `host_tool_result`
  ([the client](./duplex-client.md#what-the-client-does)); nothing crosses HTTP
  and no plugin, `.mcp.json` or `--plugin-dir` exists. There is no MCP fallback:
  if `omp` rejects `set_host_tools`, the leg ends failed with "omp refused the
  session's start: …". The decoder and the guard map `ork_<tool>` to
  `mcp__ork__<tool>`
  ([omp-names.ts](../../packages/runtime/src/adapters/omp-names.ts)), the name a
  node's rules, `ork logs` and the other drivers use; a name that starts with
  `mcp__` is no tool Ork knows. `omp` needs an explicit `tools.approval` entry
  per Ork tool (a wildcard key does not work, measured), so the overlay lists
  `ork_<tool>` for each; a tool the node's `deny` names is `deny`.
- **`--session-dir`** is `~/.ork/omp/sessions` (0700): `omp`'s whole transcripts
  and a lock file per leg, never pruned. A session file that is gone ends the
  node with `omp`'s "Session … not found" as the detail.
- **The overlay** (`--config`, strict YAML) sets `tools.xdev: false`,
  `tools.approvalMode: always-ask`, `tools.approval` from the same function as
  `--tools`, `extensionHandlers.toolCallTimeoutMs`, and turns `omp`'s extras
  off: `advisor`, `spotlight`, `prewalk`, `task.autoParallel`, model fallback,
  `waitForUsageReset`, `autoResume`, `async`, `bash.autoBackground`, `memory`,
  update checks, `mcp.enableProjectConfig`, and the discovery providers of other
  tools' files and MCP servers (`disabledProviders`, `claude-plugins` among them
  now that Ork's plugin is gone). A key `omp` does not know, or a value of the
  wrong type, is silently ignored (measured), so tests read effective values
  back.
- **Fail closed:** a missing overlay, and a guard that does not exist or throws
  at load (including a `hold.json` it expects and cannot read), each end the leg
  before any model line, exit 1, with the decisive `error:` line on stderr
  (measured). A `set_host_tools` error ends the leg failed before the first
  `prompt` (not measured on a real `omp`).

## What a session loads

`--no-skills`, `--no-rules`, `--offline` and the overlay turn `omp`'s extras
off; the user's own `omp` setup and login stay on (the overlay names only the
keys above, so any other setting the user has still applies). `omp` reads the
checkout's `AGENTS.md`; Ork's `agents-md` and `native` providers stay on, and
those of other tools do not (Claude, Codex, Gemini, Cursor and the rest). The
project's `.mcp.json` is not read (`mcpServers: false`; `mcp-json` is off and
`mcp.enableProjectConfig` is false), and a node's own servers are not given.
`layers.project` is not applied
([per driver](./what-a-session-loads.md#the-project-layer-on-each-driver)).
