# Ork's endpoint and the private folder

_Part of [The `omp` driver](./omp.md)._

## Ork's endpoint and the private folder

`kind: "config-file"` wiring. Per session Ork writes a private folder outside
the checkout (mode 0700, files 0600,
[secret-file.ts](../../packages/runtime/src/secret-file.ts)), removed when the
session ends, after a failure or a write that threw part-way, and swept after a
crash:

| File                                | Holds                                                                 |
| ----------------------------------- | --------------------------------------------------------------------- |
| `plugin/.claude-plugin/plugin.json` | the plugin `ork-session`                                              |
| `plugin/.mcp.json`                  | Ork's URL and `Authorization: Bearer <token>`, as a literal           |
| `overlay.yml`                       | the settings overlay (`--config`)                                     |
| `guard.mjs`                         | the guard, loaded with `--trusted-extension`                          |
| `hold.json`                         | the hold URL and the token, only when the session can be held         |
| `stopped`                           | written on a stop ([pausing](./omp-rules.md#pausing-and-heavy-slots)) |

- **The token** is in `.mcp.json` and `hold.json` only: never in an argument,
  the leg's environment, an event, a log, the guard's source or the checkout.
  The guard holds it in memory inside `omp`, where `omp`'s MCP client holds it
  too. Any process of the same user can read the two files; the guard refuses
  `omp`'s own file tools on the folder but cannot fence a shell.
- **Ork's tools** reach the model as `mcp__ork_session_ork_<tool>` (plugin
  `ork-session`, server `ork`, underscores kept; measured). The decoder and the
  guard both map that to `mcp__ork__<tool>`
  ([omp-names.ts](../../packages/runtime/src/adapters/omp-names.ts)), the name a
  node's rules, `ork logs` and the other drivers use. `omp` needs an explicit
  `tools.approval` entry per Ork tool (a wildcard key does not work, measured),
  so the overlay lists each; a tool the node's `deny` names is `deny`.
- **`--session-dir`** is `~/.ork/omp/sessions` (0700): `omp`'s whole transcripts
  and a lock file per leg, never pruned. A session file that is gone ends the
  node with `omp`'s "Session … not found" as the detail.
- **The overlay** (`--config`, strict YAML) sets `tools.xdev: false`,
  `tools.approvalMode: always-ask`, `tools.approval` from the same function as
  `--tools`, `extensionHandlers.toolCallTimeoutMs`, and turns `omp`'s extras
  off: `advisor`, `spotlight`, `prewalk`, `task.autoParallel`, model fallback,
  `waitForUsageReset`, `autoResume`, `async`, `bash.autoBackground`, `memory`,
  update checks, `mcp.enableProjectConfig`, and the discovery providers of other
  tools' files and MCP servers (`disabledProviders`). Not `claude-plugins`:
  Ork's plugin loads through it. A key `omp` does not know, or a value of the
  wrong type, is silently ignored (measured), so tests read effective values
  back.
- **Fail closed:** a missing overlay, a guard that does not exist or throws at
  load (including a `hold.json` it expects and cannot read), and an Ork server
  that is down each end the leg before any model line, exit 1, with the decisive
  `error:` line on stderr (measured; the server-down end is not).

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
