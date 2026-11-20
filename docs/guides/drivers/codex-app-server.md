# Codex app-server

_Part of [Drivers](../drivers.md)._

The `codex-app-server` driver runs your own `codex`
([OpenAI's Codex CLI](https://github.com/openai/codex), built against 0.169.0)
as `codex app-server`, headless: one long-lived process for each stretch of a
session, in the node's folder, which Ork talks to in both directions over
JSON-RPC. It is the second way Ork drives Codex: [`codex`](./codex.md) runs one
`codex exec` for each stretch and is proven, this one is **built and not yet
proven**. No real session has run through it, so `ork validate` and `ork run`
**refuse** a node on it
(`node … runs on driver codex-app-server, which is not yet proven on a real session`)
and `ork doctor` shows it as `skip` even when `codex` is installed and signed
in. A capped run on the maintainer's account will lift that; until then this
page says what the driver is built to do. The Codex protocol it speaks is marked
experimental by OpenAI, and every shape Ork reads comes from the schema Codex
generates, not from a run.

## Setting it up

- Install Codex and sign in with `codex login`, as for `codex`: Ork runs
  `codex login status`, reads only its exit status, and never reads Codex's own
  login files. `OPENAI_API_KEY` alone is not counted as a login.
- It needs Codex 0.169.0 or later; `ork doctor` warns about an older one.
- A node names it with `driver: codex-app-server`,
  `ork run --driver codex-app-server` or a model such as
  `codex-app-server.<model>`. A node with no model runs Codex's own default for
  your account; the model's name is passed to Codex as written.
- The node has to be in a git repository, as Codex requires.

## What it does

- A message sent while Codex is working (`ork chat`, `ork send`) reaches the
  model **before the turn ends**: Ork sends it as a steering message to the
  running turn. That is not "at once": a command that is running may finish
  first, and a message sent before the turn has begun is held until it has. On
  `codex`, a message waits for the stretch to end.
- `ork stop` interrupts the running turn. Codex ends it, and the session ends
  `interrupted`, with no report.
- When Codex asks to run a command or change a file the sandbox would refuse,
  the question comes to you in `ork decide`, with the tool and its arguments, as
  on `claude-code`. Allow answers accept **once** and deny answers decline; Ork
  never answers "accept for the session", so each call is asked again. A request
  Ork cannot read as a call it can describe is declined, never allowed.
- Anything else Codex asks the host for (a tool the host serves, a question for
  the user, a permission grant, an elicitation) is refused at once, so no turn
  waits on Ork for ever. Ork serves no host tools yet: its own tools
  (`ask_user`, `delegate`, messages, `extract`, `report`) reach Codex through an
  MCP server, as on `codex`.
- It reports tokens and no dollars, so a node with only `budgetUsd` is warned
  about; cap it with `budgetTokens`.
- A node's own `mcp` servers, `agent.subagent` nodes, `maxTurns` and a path
  scoped `Read`, `Glob` or `Grep` deny are refused, as on `codex`, so
  `ork onboard` and `ork:security-audit` do not run on it. There is no report
  schema either: the report goes through Ork's `report` tool.
- `ork pause` has no hold on this driver, as on `codex`: a paused node runs on
  to the end of its turn.
- The session id Ork keeps is Codex's thread id, so `ork resume` and `ork chat`
  continue the same thread (`thread/resume`), and a leader's question to you is
  a fork of it (`thread/fork`). Codex keeps the session in its own
  `$CODEX_HOME/sessions`; Ork does not clean it.

## What holds a node to its rules

The node is **denied unless allowed**, and the sandbox and Ork's hook hold it as
on `codex` ([permissions](../drivers.md#permissions-denied-unless-allowed)):

- **Codex's sandbox.** `read-only` for a node in `plan` mode or without a write,
  otherwise `workspace-write`, never wider, `--yolo` too. The network is off.
- **A hook Ork writes for the session.** It checks each shell command, patch and
  tool call against the node's `allow`, `deny` and `only` lists and refuses what
  is not allowed. A call that finished with no hook call behind it ends the node
  as a driver error (`Codex ran tool calls without Ork's hook …`).
- **The approval question** only adds a question for what the sandbox would
  refuse. It never grants a call the hook refuses.

It is **weaker than `codex` in one way**: `codex app-server` cannot be started
with your own config and rules ignored, as `codex exec` can. So your
`~/.codex/config.toml` (its MCP servers, its profile) and your execution-policy
`.rules` files still load into the session. Ork's hook and sandbox still see
every call, but a rule of yours that allows a command, or an MCP server of
yours, is in the session. A node that must not see them should run on `codex`.

## If a node stops before it starts

**`… exists: Ork runs its own Codex hook …`.** A hooks file of yours
(`~/.codex/hooks.json` or `$CODEX_HOME/hooks.json`, or `/etc/codex/hooks.json`)
exists, and Ork's own hook runs with Codex's hook trust bypassed, which would
run yours untrusted too. Move it away to run on this driver.

**`codex loads hooks Ork did not pass (…)`.** Codex listed a hook of yours (in
`config.toml`, a project, or the system) before the thread began. Move it away,
as above.

**`codex did not load Ork's PreToolUse hook …`.** The hook that holds the node's
rules could not be carried to `codex app-server`, so the node did not start
rather than run with weaker rules. Report it with your Codex version.

**`Codex ran tool calls without Ork's hook …`.** As on `codex`: a call ran
without the hook, so Ork ended the node and stopped Codex.

## Limits

- Not yet proven: whether `turn/steer` waits for a running command, the frame
  shapes beyond the schema, and how `codex app-server` takes the hook's trust
  setting are all unmeasured.
- A line of more than 1 MiB from Codex ends the stretch rather than reading half
  of it.
- Codex's own web search is not turned off; the sandbox's network is.

The register has what is left open: [the gaps](../../../specs/gaps.md). The
contract:
[the codex-app-server spec](../../../specs/runtime/codex-app-server.md). Why Ork
does it this way:
[ADR-115](../../../decisions/ADR-115-codex-app-server-driver.md).
