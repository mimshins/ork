# RFC-026 — The omp driver: oh-my-pi's `omp` CLI as the fifth driver

- **Status:** Accepted
- **Date:** 2026-11-19
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context): what a driver must give, what `omp` offers, what was not
  established
- [Options](#options): 1 how a session runs, 2 Ork's tools, 3 permissions, 4 a
  clean session, 5 usage and cost, 6 credentials and the doctor check, 7 names
- [Decision](#decision): the maintainer's eight decisions, accepted 2026-11-19
- [Consequences](#consequences)
- [Open questions](#open-questions): the spike as it was approved and run, and
  what the build and the gate run must still answer
- [Spike, free steps, 2026-11-19](#spike-free-steps-2026-11-19): what the steps
  that call no model showed
- [Spike, paid steps, 2026-11-19](#spike-paid-steps-2026-11-19): what real turns
  showed, and what is still unmeasured

## Context

Ork runs agents only through each tool's own CLI
([ADR-076](../../decisions/ADR-076-cli-drivers-only.md)): a driver is a
descriptor in [drivers.ts](../../packages/integrations/src/drivers.ts) and
[cli-drivers.ts](../../packages/integrations/src/cli-drivers.ts) plus an adapter
made of small strategies (command, decoder, MCP wiring, permissions, usage,
context) in [adapter.ts](../../packages/runtime/src/adapter.ts), registered in
[registry.ts](../../packages/runtime/src/registry.ts) and run by one session
runner. Four drivers exist: `claude-code`, `open-code`, `command-code` and
`codex` ([which driver](../../specs/runtime/which-driver.md)). The request is a
fifth: `omp`, the CLI of the oh-my-pi coding agent, which reaches many model
providers through logins it keeps itself.

**Is this an RFC?** Yes. The
[write-an-rfc](../../.ai/skills/write-an-rfc/SKILL.md) skill routes "a new
driver" to an RFC, and the alternatives below are real: `omp` has three ways to
run a session, three ways to fence a tool call and two ways to keep the user's
setup out, and they exclude each other in places. As in
[RFC-024](../archived/RFC-024-codex-driver.md), the decisions are one design,
taken together because each depends on the first. Decision 5 (usage) and part of
decision 7 (names) have little to weigh; they are listed so that nothing is
decided silently.

### What a driver must give the runner

The same list as RFC-024, from the existing adapters:

- a headless session in the node's folder, decoded into `RuntimeEvent`s with the
  session id, the outcome and the usage;
- a follow-up turn on the same session (an answer, a message, `ork resume`,
  `ork chat`, a leader's question fork): `command.input` for a tool that takes
  lines on stdin mid-turn (`claude-code`), otherwise the next leg resumes the
  session with the message (`open-code`, `command-code`, `codex`);
- Ork's MCP tools over HTTP with a per-session bearer token that never goes on
  the command line
  ([secret-file.ts](../../packages/runtime/src/secret-file.ts));
- the node's `tools.allow`, `deny`, `only`, permission mode and `yolo` as the
  tool's own rules, deny by default where the tool cannot ask, with shell reads
  refused and reads going through `extract`
  ([ADR-101](../../decisions/ADR-101-extract-only-reading.md));
- a model, usage and (where the tool reports it) cost, a clean session
  ([what a session loads](../../specs/runtime/what-a-session-loads.md)), node
  processes that end with Ork
  ([ADR-087](../../decisions/ADR-087-node-processes-end-with-ork.md)), and a
  doctor check that never reads a credential
  ([ADR-004](../../decisions/ADR-004-no-credentials.md)).

### What `omp` 18.22.2 offers

Read on the maintainer's machine, with no model call, no sign-in and no change
to `omp`'s own configuration. Sources: `omp --help` and the help of its
subcommands; the keys, types and descriptions of `omp config list --json` (632
settings; no value is quoted here); the 135 documents the binary ships, read
with `omp read omp://<name>.md` (among them `rpc.md`, `cli-reference.md`,
`approval-mode.md`, `hooks.md`, `extensions.md`, `extension-loading.md`,
`mcp-config.md`, `session.md`, `config-usage.md`, `context-files.md`,
`providers.md`, `settings.md`, `environment-variables.md`,
`bash-tool-runtime.md`); and `omp models --json`, once as it is and once with an
empty scratch folder as `PI_CODING_AGENT_DIR`. Everything below is what `omp`
says about itself. None of it was seen on a real turn, so each behavior is a
claim for the spike (see [Open questions](#open-questions)).

**A session.**

- `omp -p` (`--print`) runs non-interactively; `--mode json` "emits a session
  header followed by events as JSON lines", with completed messages in
  `message_end`. The prompt comes as an argument or on stdin. A terminal turn
  failure exits nonzero; a run stopped by `--max-cost` exits 3.
- `--resume <id|path>` continues a session (an id prefix is enough);
  `--fork <id|path>` makes a new session from one; `--session-dir <dir>` says
  where session files live and are looked up; `--no-session` keeps none.
  Sessions are `<timestamp>_<sessionId>.jsonl` files under the agent directory
  (default `~/.omp/agent/sessions/<encoded-cwd>/`), with a header that carries
  `id`, `cwd` and `parentSession`.
- `--mode rpc` keeps one process per session and speaks newline-delimited JSON
  over stdio ("a custom JSONL protocol, not JSON-RPC 2.0"): a `ready` frame with
  protocol versions 1 and 2; commands `prompt`, `steer`, `follow_up`, `abort`,
  `get_state` (session id and file), `fork`, `set_host_tools`,
  `get_session_stats`, `set_event_filter`; a `prompt_result` per prompt
  (`completed`, `aborted` or `error`, with `error.code: "cost_cap"` at a cost
  cap) and `session_settled` when nothing can wake the session again. A tool
  approval reaches an RPC host as an `extension_ui_request` to answer; with
  `--no-ui` a tool that needs approval "fails closed". The wire schema is
  generated (`rpc-wire.schema.json`) and clients ship for TypeScript, Python,
  Rust and Go. The documents do not mark it experimental.
- `omp acp` is an Agent Client Protocol server over stdio. RFC-014 noted that
  `opencode acp` and `cmd acp` exist too
  ([RFC-014](../archived/RFC-014-cli-drivers-only.md), Option C). Its messages
  were not read for this RFC.
- No flag or setting caps a session's turns (`--max-time` is wall-clock), and no
  flag takes a JSON Schema for the final answer.

**Tools from outside.**

- MCP servers come from files only: the project's `.omp/mcp.json`, the user's
  `mcp.json` in the agent directory, a root `mcp.json` or `.mcp.json`, other
  tools' configurations (Claude Code, Codex, Gemini CLI, OpenCode, Cursor,
  Windsurf, VS Code), plugins and "OMP extension packages". No flag gives one
  for a run: `--config` loads a `config.yml`-style settings overlay, and the
  five `mcp.*` settings hold no server list.
- A header value that names an environment variable is replaced by its value
  before the request, `${VAR}` is expanded when a native file is read, and a
  value starting with `!` runs a command. So a token can stay out of the file
  and the arguments.
- `OMP_MCP_REQUIRE_READY=1` makes print mode exit 1 before the first turn when a
  configured server is pending or failed. `OMP_MCP_TIMEOUT_MS` sets the request
  timeout for every server (30 seconds by default; `0` disables it).
- With the default `tools.xdev: true`, tools that are not core built-ins, MCP
  tools included, can be mounted as `xd://` devices the model drives through
  `read` and `write`, not offered as tools. `tools.xdev: false` offers every
  enabled tool directly. This is the shape of OpenCode's Code Mode, which hid
  Ork's tools from the model until 2.3.2 (`MIN_OPENCODE_VERSION`).
- An MCP tool is named `mcp__<server>_<tool>` with the server's own prefix
  dropped, so Ork's `report` would be `mcp__ork_report`, not the
  `mcp__ork__report` the other drivers see.
- An extension is a TypeScript or JavaScript module `omp` loads into its own
  process: `-e <path>` (repeatable), `--no-extensions` (discovery off, explicit
  paths still load), and `--trusted-extension <absolute file>`, an exact
  allowlist: "A load failure aborts startup rather than silently dropping an
  allowlisted module." It cannot be combined with `-e`, and it does not admit a
  package's sibling MCP configuration. An extension can register tools
  (`pi.registerTool`) and handle events.

**Fences.**

- No sandbox flag or setting was found. The approval document says of `omp`'s
  own shell rules: "it is not process or filesystem containment".
- `tools.approvalMode` is `yolo` by default: every tool call runs unasked. The
  other modes are `always-ask` (read-tier tools run, write and exec ask),
  `always-ask-cached` (file reads ask too) and `write`. Without an interactive
  UI (print mode) a call that would ask "fails rather than silently allowing
  it".
- `tools.approval.<tool>: allow | deny | prompt` holds in every mode, a `deny`
  always. `bash.patterns` is an ordered list of `match` and `approval` rules
  (`*` wildcards only; a `deny` is absolute; a compound line is judged per
  segment). `tools.restrictedFolders` makes every read, write, search or command
  in a folder ask, which in print mode refuses it; a shell command run elsewhere
  that names a file inside is not matched.
- An extension's `tool_call` handler runs before each model-issued call, sees
  the tool's name and input, and refuses it with `{ block: true, reason }`; the
  runner "fails closed on an error or timeout" in a handler (30 seconds by
  default, `extensionHandlers.toolCallTimeoutMs`).
- `--tools <a,b,c>` enables only the named tools; `--no-tools` none. The
  built-ins on by default include `read`, `edit`, `write`, `bash`, `grep`,
  `glob`, `find`, `eval`, `task`, `web_search`, `lsp`, `ast_edit` and `debug`.
- Two tools pass around the fences above. `eval` runs Python and JavaScript and
  can start a shell; a `bash.patterns` deny does not apply to it, and its
  browser and computer helpers emit no `tool_call`. `task` starts subagents,
  which "run headless with `tools.approvalMode: yolo`", the parent's `task`
  approval being "the authorization boundary".

**What a session loads.**

- The user's `config.yml` always applies under an overlay; nothing ignores it
  whole. Settings layer as environment, runtime flags, `--config` overlays,
  project (`<cwd>/.omp`), global; an array in a higher layer replaces the lower
  one. An overlay that is missing or invalid is a hard error.
- Switches per run: `--no-extensions`, `--no-skills`, `--no-rules`,
  `--no-context-files` (this one also drops the repository's `AGENTS.md`),
  `--no-title`, `--no-lsp`, `--no-pty`, `--no-prewalk`, `--no-judge`,
  `--no-spotlight`, `--offline` ("Restrict auxiliary services to the active
  model's provider (not a network firewall)").
- `omp` reads `AGENTS.md` and `CLAUDE.md` natively, walking up from the folder.
  It also reads other tools' project files (`.claude/`, `.codex/`, `.gemini/`,
  `.cursor/`, `.github/copilot-instructions.md`); their user-level files are
  opt-in (`enabledProviders`), and `disabledProviders` turns a source off.
- `--profile <name>` (or `OMP_PROFILE`) gives "an isolated profile for auth,
  sessions, settings, and caches": a profile sees none of the default profile's
  logins or configuration.
- Features that spend or change things by themselves: the advisor (off by
  default), judge-backed features (`prewalk.auto`, `task.autoParallel`, the
  `find` tool, title checks), Spotlight (off by default; when on it posts tool
  output to an outside service), prewalk and `--plan-yolo` (switch the model
  mid-session), `retry.modelFallback` (on by default: another model answers when
  one fails), `autoResume` (off by default; skipped when a session flag or
  session directory is given), memory backends (off by default), `update.auto`
  (off by default), background jobs (`async.enabled` and
  `bash.autoBackground.enabled`, both on by default), and `launch.persist`,
  which print, RPC and ACP modes "always turn it on, so a server the agent
  leaves running outlives the omp process".

**Usage and credentials.**

- Each assistant message carries `usage`: `input`, `output`, `cacheRead`,
  `cacheWrite`, `totalTokens` and `cost` (the same four and `total`, in
  dollars). The dollars are computed from `omp`'s model catalogue. For one
  subscription provider its documents call the figure "API-equivalent reference
  pricing" and say a gateway's own streamed cost is authoritative where there is
  one; what a subscription login reports in general is not known.
  `omp models --json` gives each model's `cost` and a `pricingStatus` of `fixed`
  or `unknown`.
- `--max-cost <usd>` stops sending requests once the session's spend reaches it,
  subagents and side requests included; a request in flight can pass it. Side
  requests (titles, compaction, advisor, judge) are recorded as `model_usage`
  entries outside the transcript.
- Logins live in `omp`'s own store in the agent directory (or a broker), per
  provider; dozens of provider keys are also read from the environment. There is
  no `login status` command: `omp login` signs in, `omp auth` exports and
  imports credentials, `omp token` prints one, `omp usage` asks the providers.
  None of the last three was run.
- `omp models --json` lists the models that are "available": the provider is not
  disabled and has "configured authentication" or needs none, "a fast
  configuration check, not a credential validation request". Measured: with an
  empty agent folder and no provider key in the environment it printed
  `{"models":[]}` and exited 0; with the user's own folder it listed models only
  for the providers that have a login.

**The help and the documents disagree in places.** `--fork`,
`--trusted-extension`, `--yolo`, `--provider-session-id` and
`--prompt-cache-key` are in the shipped `cli-reference.md` and absent from
`omp --help`. The free steps of the spike found that 18.22.2 accepts
`--trusted-extension`, and the paid steps that it accepts `--fork`.

### What could not be established

Everything a running session would show: the JSON lines themselves, the exit
codes, whether a resumed leg keeps its id, whether a handler's refusal reaches
the model, what a session loads from the user's setup, and the RPC frames of a
real turn. The steps that need no model ran later the same day, on the
maintainer's approval; what they added is under
[Spike, free steps](#spike-free-steps-2026-11-19), and the text above is left as
it was written before them.

Not in scope: `omp`'s collaboration, sharing, streaming and voice features;
`omp commit`, `omp cleanse` and `omp worktree` (Ork manages commits and
worktrees itself); `--from-claude` and `--from-codex` session imports.

## Options

### 1. How a session runs

#### Option 1A — `omp -p --mode json` per leg, `--resume` for follow-ups

- **Pros:** the shape of `codex exec`, `open-code` and `command-code`: the brief
  on stdin or as an argument, a `legDecoder` for the exit code, a later message
  waiting for the leg's end and continuing with `--resume <id>`, a question fork
  with `--fork <id>`. No new strategy in `CliAdapter` and no change to the
  session runner. Usage arrives per message, so `budgetTokens` could stop a
  running leg, which `codex` cannot.
- **Cons:** no mid-turn message (`midTurnMessages: false`) and no approval Ork
  can answer (`permissionPrompt: false`): a call that would ask is refused. One
  process per turn, with `omp`'s start-up each time. Print mode disposes the
  session at its end and cancels the background jobs the turn started. Resume
  looks a session up by id, follows "continuations" to a sibling file in some
  cases, and asks a question on a terminal when the session's folder is gone, so
  what a resumed leg does must be measured.

#### Option 1B — one `omp --mode rpc` process per session

- **Pros:** `steer` delivers a message during a turn, `abort` stops one, an
  approval comes to Ork as a request it can answer (`permissionPrompt: true`),
  and `set_host_tools` lets Ork offer its tools over the same pipe, with no MCP
  configuration and no token at all. `prompt_result` and `session_settled` are
  explicit ends. The protocol is documented, versioned in its `ready` frame and
  not marked experimental. RPC also starts from neutral defaults for the
  advisor, memory and task isolation, and generates no title.
- **Cons:** `CliAdapter` has only `command.input` (lines written to stdin), so
  this needs a two-way client in the runner: requests with ids, answers to
  requests the tool sends, an interrupt that is a frame and not a signal. It is
  the same missing piece as `codex app-server`
  ([G39](../../specs/gaps.md#gaps)). The protocol is `omp`'s own and has grown
  optional parts (chunked frames above 1 MiB, event filters) the client must
  handle or pin. A process that lives across turns must be found again by
  `ork resume` and `ork chat` after Ork restarts, which means resuming by id
  anyway.

#### Option 1C — `omp acp`, the Agent Client Protocol

- **Pros:** a protocol three of Ork's tools speak (`omp acp`, `opencode acp`,
  `cmd acp`), so one client could later serve three drivers; permission requests
  are part of it (`session/request_permission`).
- **Cons:** not read for this RFC beyond `omp`'s approval notes, which say ACP
  has no per-session approval field and that an ACP server takes its settings
  from the process's flags. What it reports of usage, and whether it carries
  everything Ork needs, is unknown. `codex` does not speak it.

#### Option 1D — per leg now; long-lived protocol drivers as one later RFC

- **Pros:** the build of 1A, proven on a gate run, with the gaps recorded. The
  related follow-up that is due, "Write the RFC for codex app-server" (left by
  RFC-024 and [ADR-102](../../decisions/ADR-102-codex-driver.md)), becomes one
  RFC for both tools. What they would share is the runner-side strategy: a
  long-lived two-way session that can send a message mid-turn, interrupt, and
  answer a request from the tool. What stays per driver is the codec: `omp`'s
  JSONL frames, Codex's JSON-RPC, perhaps ACP. Designing it once, against two
  real protocols, is cheaper than designing it for `omp` now and bending it for
  Codex later.
- **Cons:** the limits of 1A until that RFC; `omp` then has two shapes over its
  life, and the per-leg one may be replaced.

### 2. How Ork's tools reach the agent

Every option keeps the token out of the arguments. None keeps it from a process
the agent starts: `omp` builds a shell command's environment from its own (its
documents name no filter such as Codex's for `*TOKEN*` names), and a file Ork
writes is readable by the same user. The token is the session's own and opens
only the tools the session already has, so the exposure is small, but it is
real, and the spike measures it.

#### Option 2A — a project file, `.omp/mcp.json` in the worktree

- **Pros:** the documented, primary place; print mode waits for it and
  `OMP_MCP_REQUIRE_READY=1` fails the leg when Ork's server is not there.
- **Cons:** a file in the checkout, against the rule that the worktree stays
  clean (RFC-014): a `tool.git` step would see it, and an attached project may
  have its own `.omp/mcp.json` to merge with and restore.

#### Option 2B — an extension package in Ork's private folder, passed by `-e`

- **Pros:** `omp` lists "OMP extension packages" as an MCP source, and says an
  explicitly named package keeps its sibling roots under `--no-extensions`. So a
  folder Ork writes for the session (0700, removed after it, as `secret-file.ts`
  does) could carry Ork's server, with the header naming an environment
  variable. Nothing in the checkout or the user's files; Ork's one MCP endpoint
  ([ADR-011](../../decisions/ADR-011-in-house-mcp-server.md)) stays the route
  for every driver.
- **Cons:** `-e` cannot be combined with `--trusted-extension`, and a package
  entry that fails to load is skipped, not fatal, so decision 3's guard would
  need a canary. MCP tools sit behind `xd://` unless `tools.xdev` is off.
- **Measured on the free steps:** a folder with a `package.json` and an
  `mcp.json` beside it loads the server under `--no-extensions`, with the header
  taken from the environment; `-e` with `--trusted-extension` exits 2.

#### Option 2C — Ork's tools as extension tools

Ork's session extension (the one decision 3 may write) registers each Ork tool
with `pi.registerTool` and forwards a call to Ork's HTTP endpoint.

- **Pros:** one file, loaded with `--trusted-extension`, so a load failure stops
  the leg before any model call; no MCP configuration anywhere; the token is
  read by the extension from Ork's private folder and is never in the leg's
  environment.
- **Cons:** Ork would write and keep an MCP client inside a module that runs in
  `omp`'s process, and translate its tools' JSON Schemas to what `registerTool`
  accepts (not measured). Ork's tools would reach `omp` by a second route beside
  the MCP one, with names Ork chooses. Extension tools may sit behind `xd://`
  too.
- **Measured on the free steps:** `registerTool` took a plain JSON Schema and
  the tool was offered under its name with `tools.xdev: false`, not with the
  default. Calling it was not tried.

#### Option 2D — host tools over RPC (only with option 1B)

- **Pros:** `set_host_tools` and `host_tool_call`: no file, no token, no HTTP.
- **Cons:** exists only in RPC mode; a second route beside MCP, as 2C.

#### Option 2E — a plugin folder in Ork's private folder, passed by `--plugin-dir`

Added after the free steps of the spike, which found it.

- **Pros:** measured: a folder with `.claude-plugin/plugin.json` and a
  `.mcp.json` beside it, passed by `--plugin-dir`, loads Ork's server with
  nothing in the checkout or the user's files; the header takes its value from
  the leg's environment; and, unlike `-e`, it is accepted together with
  `--trusted-extension`, so decision 3's guard keeps its fail-closed loading in
  the same leg. Ork's one MCP endpoint stays the route.
- **Cons:** `omp --help` gives `--plugin-dir` one line, and the layout was found
  by trying: the other one tried (a root `plugin.json` with a root `mcp.json`)
  did not connect. A plugin can also carry skills, commands and hooks, so the
  folder must hold nothing else. As 2B, the tools are tools only with
  `tools.xdev: false`.
- **Measured on the paid steps:** the model called the plugin's tool, named
  `mcp__<plugin>_<server>_<tool>`; a two-minute call was waited for; a server
  that is down ends the leg before any model request
  (`OMP_MCP_REQUIRE_READY=1`). A header taken from the environment puts the
  token in the agent's shell, so it is better written in the file.

Not offered: a private agent directory per run (`PI_CODING_AGENT_DIR`) holding
Ork's `mcp.json`. The agent directory is also where the login lives, so the
session would have none unless Ork copied a credential, which ADR-004 forbids.

### 3. How a node's rules are enforced

An `omp` session with nothing set runs every tool call unasked (`yolo`) and has
no sandbox. So the driver must never start a leg without its fence, and if no
option below can be shown to hold, the driver stays unproven and refuses every
node.

#### Option 3A — `omp`'s own approval settings, in a per-session overlay

Ork writes a `config.yml` overlay for the session and passes it by `--config`:
`tools.approvalMode: always-ask`, a `tools.approval` entry per tool, the node's
shell rules as `bash.patterns`, and `tools.restrictedFolders` for path-scoped
read denies.

- **Pros:** no Ork code inside `omp`. An overlay that fails to load is a hard
  error, so it fails closed at start. In print mode a call that would ask is
  refused, which is deny by default for the write and exec tiers. An overlay
  sits above the project's own `.omp/config.yml`, so a checkout cannot widen it.
- **Cons:** read-tier tools always run in `always-ask`, so reads are not denied
  by default (`always-ask-cached` asks for file reads too, to measure). Rules in
  Claude Code's words must be translated: `Bash(<prefix>)` to a `*` pattern
  (close), but a path-scoped edit such as `Edit(src/**)` has no equivalent,
  because `tools.approval.edit` covers the whole tool. Such nodes would be
  refused by `ork validate`. A second matcher beside the shared one
  ([tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts)).

#### Option 3B — a `tool_call` handler in Ork's session extension

The Codex hook's equivalent
([codex-hook.ts](../../packages/runtime/src/adapters/codex-hook.ts)): a module
written for the session in Ork's private folder, holding the node's rules in
Claude Code's words and the shared matcher, refusing every call the node did not
allow, Ork's own tools always through.

- **Pros:** one matcher on every driver, so `Bash(<prefix>)`, path-scoped edits
  and MCP rules keep their meaning. The handler sees `omp`'s read tools, so a
  path-scoped read deny could hold (`readDenies: true`, to measure) and a shell
  read can be refused as RFC-025 requires. A handler that throws or times out
  refuses the call. Loaded with `--trusted-extension`, a module that does not
  load stops the leg before any model call, which is stronger than Codex's
  canary ([L446](../../specs/gaps/codex-limits.md)). A handler may wait, so
  holding a paused node's call
  ([ADR-041](../../decisions/ADR-041-pause-continue-stop.md)) may be possible
  where Codex's hook could not (G40).
- **Measured on the paid steps:** a refusal reaches the model with its reason
  and is on the JSON lines; the handler saw `bash`, `read`, `write` and an MCP
  call; it fails closed after 30 seconds, and with a longer
  `extensionHandlers.toolCallTimeoutMs` it held a call for 40 seconds.
- **Cons:** code Ork writes against `omp`'s extension API, which runs in `omp`'s
  process and can change between versions. `--trusted-extension` is not in
  `omp --help`. `eval`'s helper calls emit no `tool_call`, and subagents are
  said to keep the parent's handlers but run in `yolo`; both tools must be off.
  `read` also takes URLs, archives and internal addresses (`xd://`, `skill://`),
  which the matcher must refuse or understand.

#### Option 3C — both: settings as the wall, the handler as the rules

`--tools` names only the tools the node's rules can ever allow (never `eval` or
`task`), the overlay sets `always-ask` and denies what is left out, and the
handler of 3B decides each call.

- **Pros:** two independent fences, as Codex's sandbox and hook: a handler that
  misses a call still meets `omp`'s own refusal. Tools the node never uses are
  not offered at all, which also saves context.
- **Cons:** both to build and keep; in `always-ask` a write the handler allowed
  would still ask and be refused in print mode, so the overlay must allow, per
  tool, exactly what the handler may allow, and the two must be generated from
  the same rules.

#### Option 3D — `--tools` only; refuse what it cannot hold

- **Pros:** nothing to write; a tool that is not enabled cannot be called.
- **Cons:** tool-level only. A node with a `Bash(<prefix>)` rule, a path-scoped
  rule or a `deny` inside an allowed tool would be refused, Ork's own build
  nodes among them.

### 4. A clean session, and `omp`'s own features

Whichever option is taken, some switches are not a choice, because the feature
breaks a promise Ork makes. Proposed for every leg, each to confirm on the
spike:

| `omp` feature                              | Under Ork                                         | How                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Subagents (`task`), and `eval`'s `agent()` | off; `subagents: false`                           | left out of `--tools`; `tools.approval.task: deny` and `tools.approval.eval: deny`                                                     |
| Advisor                                    | off                                               | never `--advisor`; `advisor.enabled: false`                                                                                            |
| Judge, Spotlight, other auxiliary calls    | off                                               | `--no-judge --no-spotlight --offline --no-title`; `spotlight.experiment.enabled: false`; `prewalk.auto` and `task.autoParallel` off    |
| A thinking level chosen by a side request  | off                                               | `--thinking <level>` on every leg (the node's `effort`, or a fixed default)                                                            |
| Prewalk, `--plan-yolo`, model fallback     | off: a node runs the model it names               | `--no-prewalk`; never `--plan-yolo`; `retry.modelFallback: false`; `retry.waitForUsageReset: false`                                    |
| Auto-resume                                | off: a new session never continues an old         | `autoResume: false`, and Ork's own `--session-dir`                                                                                     |
| LSP                                        | off: no formatting of files the node did not edit | `--no-lsp`                                                                                                                             |
| PTY bash                                   | off                                               | `--no-pty`                                                                                                                             |
| Background jobs, services that persist     | off: node processes end with Ork (ADR-087)        | `async.enabled: false`, `bash.autoBackground.enabled: false`; whether `launch.persist` can be turned off in print mode is not known    |
| Memory backends                            | off                                               | `memory.backend: off`                                                                                                                  |
| Updates                                    | off: a run never changes the binary               | `startup.checkUpdate: false`, `update.auto: false`                                                                                     |
| The user's extensions, skills and rules    | off                                               | `--no-extensions` (or `--trusted-extension`), `--no-skills`, `--no-rules`                                                              |
| Context files                              | the repository's `AGENTS.md` only                 | not `--no-context-files`; the user-level files and other tools' project files turned off by `disabledExtensions` / `disabledProviders` |
| MCP servers of the user and other tools    | off; `mcpServers: false` until measured           | `mcp.enableProjectConfig`, `disabledProviders`; what remains from the user's `mcp.json` is not known                                   |
| Ork's instructions                         | added to the system prompt on the first leg       | `--append-system-prompt`                                                                                                               |

What is a choice is where the session's settings and login come from.

#### Option 4A — the user's own agent directory, with Ork's overlay and flags

- **Pros:** the login is used where it is, untouched, as Codex's
  ([RFC-024](../archived/RFC-024-codex-driver.md), option 3A). Ork's overlay
  pins every setting Ork depends on, above the user's. Session files go to Ork's
  own `--session-dir`, so a run adds nothing to the user's session list (better
  than `codex`, [L439](../../specs/gaps/codex-limits.md)).
- **Cons:** the user's `config.yml` still applies for every key the overlay does
  not name, and `omp` has several hundred. A setting Ork did not think of (a
  model role, a provider tier, a new feature in the next release) changes a run.
  The list of pinned keys must be kept true as `omp` changes.

#### Option 4B — a named profile for Ork (`--profile ork`)

- **Pros:** full isolation by `omp`'s own means: no user settings, extensions,
  skills, MCP servers or sessions reach the run.
- **Cons:** a profile has its own logins. The user must sign in once more inside
  it (`omp --profile ork login <provider>`); Ork never copies a credential. A
  provider key in the environment still works in any profile. `ork doctor` must
  check that profile and say so. A second place the user's accounts are kept.

#### Option 4C — whatever profile the user's environment names, with the overlay

Ork passes no `--profile`; an `OMP_PROFILE` in the user's environment reaches
the leg and the doctor check alike, because Ork passes the environment through.

- **Pros:** 4A by default, and 4B for a user who wants it, with no setting in
  Ork: they create the profile, sign in to it and export the variable.
- **Cons:** isolation is the user's job, and the default remains 4A's leak.

### 5. Usage and cost

#### Option 5A — tokens and dollars (`price: true`), with `--max-cost` as well

- **Pros:** `omp` reports a `cost` on every message, as `open-code` does per
  step, so `budgetUsd` can be enforced from the events, and `--max-cost` adds
  `omp`'s own stop, which also counts the side requests Ork may not see. Usage
  per message lets `budgetTokens` stop a running leg.
- **Cons:** the dollars are `omp`'s catalogue prices, not a bill: for a
  subscription login they are notional, and for a model whose `pricingStatus` is
  `unknown` the cost is zero, so `budgetUsd` alone would not bind such a node
  and Ork cannot tell from the capability.
- **Measured on the paid steps:** each assistant message on the JSON lines
  carries its request's tokens and `cost`; `--max-cost` ends the leg with exit 3
  and a `cost-gate` notice; a side request (`omp` choosing a thinking level) was
  recorded in the session file and on no line, and passing `--thinking` avoids
  it.

#### Option 5B — tokens only (`price: false`)

- **Pros:** as `codex` and `command-code`: `budgetTokens` binds, `ork validate`
  warns that `budgetUsd` alone cannot, and no notional dollar is shown.
- **Cons:** discards a figure the tool reports; a run that mixes drivers gets a
  partial dollar total where it could have had a whole one.

A price table kept by Ork is not offered, for the reason RFC-024 gave.

### 6. Credentials and the doctor check

`omp` has no command that answers "signed in?" with an exit status, and a login
is per provider, so "signed in" means "some provider is usable".

#### Option 6A — `omp --version`, then count the models of `omp models --json`

- **Pros:** `omp` itself says which models are available; Ork reads no
  credential file and runs nothing that prints one. Measured both ways (an empty
  list with no login, a list with one). `ork doctor` can say "logged in" or
  "sign in with `omp login`".
- **Cons:** it reads the command's output, not only its exit status, so
  `installedCli`'s `loginStatus` (exit status only) needs a second form. It
  proves a provider is configured, not that the credential still works ("not a
  credential validation request"). It says nothing about the model a node names.
  Whether the command waits on the network is not measured.

#### Option 6B — the version only, as `open-code` and `command-code`

- **Pros:** the existing check, no new code: "sign in with `omp login` if a
  session asks".
- **Cons:** `ork doctor` calls the driver ready on a machine with no login, and
  the first session finds out.

#### Option 6C — 6A, and the node's model checked before a run

`ork run` also checks that a node's `omp.<provider>/<model>` is in the list.

- **Pros:** a model the account cannot use is refused before any spend
  (prevention over detection).
- **Cons:** works only for the exact `provider/model` form; a fuzzy name is
  `omp`'s to resolve. One more process per run. A new kind of check no other
  driver has.

In every option Ork passes no `--api-key` and never runs `omp auth`, `omp token`
or `omp usage`. `--profile` decides which logins exist (decision 4): the doctor
check and the legs must run under the same profile, or `ork doctor` reports a
login the session will not find.

### 7. Names, models and the first version

**The driver id.**

- **`omp`:** the command, and what the tool's own documents call it. The model
  prefix stays short: `omp.openai/gpt-5.2`. It breaks the pattern of the other
  ids, which are product names and not commands (`claude-code` for `claude`,
  `open-code` for `opencode`, `command-code` for `cmd`).
- **`oh-my-pi`:** the product's name, in the pattern of the others; a longer
  prefix (`oh-my-pi.openai/gpt-5.2`) and a name fewer users type.

Neither has a dot, so `driverOf` reads either
([ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md)).

**The model.** `omp --model` takes a fuzzy name (`opus`), an exact
`provider/model`, or a role the user configured (`slow`, `@smol`).

- **7A — passed as written:** the rule of RFC-015 ("the rest is passed to that
  tool as it is"); the resolved provider and model are read from the stream and
  recorded. A fuzzy name or a role can resolve differently on two machines.
- **7B — only `provider/model`:** `ork validate` refuses a name with no `/`.
  Reproducible, and the form decision 6C can check; stricter than every other
  driver.

With no model on the node, `omp` uses its own default, which is the user's
configured role or last choice (as Codex's account default, RFC-024 option 6A);
the alternative is to refuse an `omp` node with no model. `effort` maps to
`--thinking`.

**The first version and the gate.** `MIN_OMP_VERSION` would be the version the
gate run proves (18.22.2 was read; `omp` releases often and has a canary
channel). As every driver since RFC-014, the descriptor ships `proven: false`
and no run takes it until a maintainer-run, capped session passes.

## Decision

Accepted by the maintainer on 2026-11-19, who chose each of the eight decisions
below. The options above and the two spike sections are the record of how they
were reached.

1. **How a session runs: option 1D.** Each leg is one `omp -p --mode json`
   process; a later message or answer waits for the leg's end and continues the
   session with `--resume <id>`. `midTurnMessages` and `permissionPrompt` are
   `false`. The long-lived shape (`omp --mode rpc`, `codex app-server`) goes
   into one later RFC shared by both drivers, which replaces the follow-up
   RFC-024 left for Codex alone.
2. **How Ork's tools reach the agent: option 2E.** A plugin folder, passed with
   `--plugin-dir`, carries Ork's MCP server, with `tools.xdev: false` so that
   Ork's tools are offered as tools. The token is written in the plugin's own
   `.mcp.json` (mode 0600), not passed in the leg's environment.
3. **How a node's rules are enforced: option 3C, both.** Ork's guard, the
   `tool_call` handler loaded with `--trusted-extension`, is what refuses a
   call, and `omp`'s own approval settings are the wall behind it. `eval` and
   `task` are always left out of `--tools`.
4. **Where settings and the login come from: option 4C.** The user's environment
   decides: the user's own `omp` folder, or the `OMP_PROFILE` they set, with
   Ork's overlay and flags over it. There is no dedicated profile for Ork. What
   the overlay does not name leaks in, and is recorded as a gap. The table of
   features turned off stands as proposed, with `--thinking` on every leg.
5. **Usage: option 5A.** Dollars and tokens: `price: true`, and `--max-cost` on
   the leg.
6. **The doctor check: option 6A.** `ork doctor` reads `omp models --json` and
   counts the models. Checking a node's own model before a run (6C) is a
   follow-up.
7. **Names.** The driver id is `omp`. A model is passed as written (fuzzy, exact
   or `provider/model`), and a node with no model is allowed. `MIN_OMP_VERSION`
   is 18.22.2. The driver ships `proven: false` first, with a gate run as Codex
   had.
8. **The spike.** The free steps and the paid per-leg steps ran, under the
   maintainer's two approvals and a cap of 5 dollars; see
   [Spike, free steps](#spike-free-steps-2026-11-19) and
   [Spike, paid steps](#spike-paid-steps-2026-11-19). Step 13, the RPC turn, was
   not run: it waits for the later RFC.

What the build takes from the spike with these decisions. These are measured
facts the adapter follows, not further decisions:

- The plugin folder and the guard are written for the session in Ork's private
  folder, outside the checkout, and removed after it. A guard that does not load
  stops the leg before any model request, and a leg never starts without it.
- Every leg passes `OMP_MCP_REQUIRE_READY=1`, so a leg whose Ork server is not
  there ends before any model request, and a request timeout long enough for
  `delegate` (`OMP_MCP_TIMEOUT_MS`).
- Ork's tools are named `mcp__<plugin>_<server>_<tool>`; Ork chooses the name by
  naming its plugin.
- The session id is the first line's `id`; usage and cost are read from each
  assistant `message_end`; a leg that cannot start explains itself on stderr.

What the descriptor declares:

| Capability         | Value   | On what ground                                                                                       |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `questions`        | `true`  | measured: the model called the stand-in for Ork's tool                                               |
| `permissionPrompt` | `false` | decision 1; `omp`'s own approvals refuse in print mode                                               |
| `midTurnMessages`  | `false` | decision 1                                                                                           |
| `price`            | `true`  | decision 5                                                                                           |
| `reportSchema`     | `false` | no schema flag found; Ork's `report` tool                                                            |
| `turnLimit`        | `false` | nothing caps turns, so `ork onboard` and `ork:security-audit` are refused, as on `codex` (L454)      |
| `mcpServers`       | `false` | not measured                                                                                         |
| `subagents`        | `false` | decision 3: `task` is left out of `--tools`                                                          |
| `readDenies`       | `true`  | proposed, not decided: measured for `read` only; `false` if the gate run shows `grep` or `glob` pass |
| `proven`           | `false` | decision 7, until the gate run                                                                       |
| `onePerCheckout`   | `false` | nothing per folder to lease                                                                          |

## Consequences

What follows from the decisions:

- **Positive.** A fifth driver, and through it the providers `omp` reaches with
  the user's own logins, without a new credential path in Ork.
- **Negative.** A second tool (after `codex`) whose fence is code Ork writes for
  it, with settings Ork must keep true, against a CLI that changes often. With
  per leg sessions, the same limits as `codex` for messages and approvals.
- **Gaps to record in `specs/gaps.md` when the driver is built:** no mid-turn
  message and no approval through Ork (as G39); the user's settings that Ork's
  overlay does not name; side requests that are on no JSON line; dollars that
  are catalogue prices, and models with no price; `turnLimit` and the built-in
  workflows it refuses; a token the same user can read in Ork's private folder.
- **What a driver must change,** as RFC-024 listed for Codex: a descriptor and
  id (`AGENT_DRIVERS`, `DriverId`, `DRIVER_IDS`) with its doctor check; an
  adapter, a decoder, the guard of decision 3 and the plugin folder of decision
  2 under `packages/runtime/src/adapters/`; the `ADAPTERS` record; a fake `omp`
  under `packages/runtime/test/fixtures/` with one entry in the contract suite;
  the regenerated `workflow.schema.json`; the tests that list drivers in
  `schema`, `core`, `nodes` and `cli`.
- **Specs and docs, in the same change:** a new `specs/runtime/omp.md`,
  `specs/runtime.md`, `which-driver.md`, `specs/gaps.md` with a limits chunk as
  [codex-limits.md](../../specs/gaps/codex-limits.md), a guide beside
  [docs/guides/drivers/codex.md](../../docs/guides/drivers/codex.md), the
  accounts, installation and troubleshooting guides, a bullet in the next
  release notes, the interaction map and roadmap, a changeset, and the ADR that
  ships this RFC (`pnpm rfc:close RFC-026`).
- **Follow-up work.** By decision 1, one RFC for long-lived protocol drivers
  that replaces the follow-up RFC-024 left for `codex app-server` alone; the
  gate run that makes the descriptor `proven`; by decision 6, a check of a
  node's own model before a run.

## Open questions

No decision is open. What the build and the gate run must still answer is the
list "Still unmeasured" at the end of
[Spike, paid steps](#spike-paid-steps-2026-11-19), and the two questions at the
end of this section. The rest of this section is the spike as it was approved
and run: steps 1 to 4, 14 and 15 call no model
([Spike, free steps](#spike-free-steps-2026-11-19)); steps 5 to 12 ran real
turns on the maintainer's account, in a scratch git repository, each under
`--max-cost`, with the changes the paid section names; step 13 was not run and
waits for the later RFC.

Set-up, once, in `bash` (`$CLEAN` must split into words; `zsh` passes it as one
argument and `omp` exits 2 on it):

```sh
W=$(mktemp -d) && git -C "$W" init -q   # a scratch repository; run every step from it
O=$(mktemp -d) && chmod 700 "$O"        # stands in for Ork's private folder
E=$(mktemp -d)                          # an empty agent folder: no login
M=<provider/model>                      # a cheap model the account accepts
PORT=<port>                             # a stand-in for Ork's MCP endpoint, logging each request's headers
CLEAN="--no-skills --no-rules --no-title --no-lsp --no-pty --no-prewalk --no-judge --no-spotlight --offline --session-dir $O/sessions --config $O/ork.yml"
```

`$O/ork.yml` holds the settings of decision 4's table and `tools.xdev: false`.
`$O/guard.ts` is an extension whose `tool_call` handler appends each call to
`$O/calls.jsonl` and returns `{ block: true, reason: "refused by Ork" }` for a
`bash` command containing `forbidden`. `$O/pkg` is an extension package (a
`package.json` naming one extension) with an `mcp.json` beside it; `$O/plugin`
is a plugin folder (`.claude-plugin/plugin.json`) with a `.mcp.json` beside it.
Both name `http://127.0.0.1:$PORT/mcp` with the header
`Authorization: ORK_OMP_MCP_AUTH`.

1. **The header line and the no-login error (no model call, no login). Ran.**
   `cd "$W" && PI_CODING_AGENT_DIR="$E" omp -p --mode json $CLEAN "hi" </dev/null; echo "exit $?"`
   What the first line holds (the session id), what an absent credential prints,
   and the exit code.
2. **What a session loads (no model call; reads the user's own setup). Ran.**
   `cd "$W" && printf '%s\n' '{"id":"1","type":"get_state"}' | omp --mode rpc --no-ui --no-extensions $CLEAN --tools read,edit,write,bash,grep,glob`
   From `systemPrompt` and `dumpTools`: which of the user's skills, rules,
   context files, MCP servers and tools still reach the session, and the tools'
   exact names. Again without `$CLEAN`, to see what the flags remove.
3. **The guard loads or the leg stops (no model call). Ran.**
   `cd "$W" && printf '%s\n' '{"id":"1","type":"get_state"}' | PI_CODING_AGENT_DIR="$E" omp --mode rpc --no-ui --no-session --trusted-extension "$O/guard.ts" --config "$O/ork.yml"`
   Whether 18.22.2 accepts `--trusted-extension`; then the same with a
   `guard.ts` that throws: does start-up abort, with which exit code.
4. **Ork's server from a package, and the token (no model call). Ran.**
   `cd "$W" && OMP_MCP_REQUIRE_READY=1 ORK_OMP_MCP_AUTH="Bearer probe" PI_CODING_AGENT_DIR="$E" omp -p --mode json $CLEAN --no-extensions -e "$O/pkg" "hi" </dev/null; echo "exit $?"`
   Whether the stand-in receives the `Authorization` header (the package's
   `mcp.json` loaded, the variable resolved); then with the stand-in stopped:
   exit 1 before the turn. The last part could not be answered without a login
   and moves to step 6.
5. **The JSON lines of a real turn. Ran.**
   `cd "$W" && omp -p --mode json $CLEAN --model "$M" --max-cost 0.50 "Run the shell command 'echo hi', create the file a.txt containing x, then answer with the word done." </dev/null; echo "exit $?"`
   Every line type: the header, assistant text, tool calls and results (`bash`,
   `write`, `edit`), the final message, `usage` and `cost` and whether they come
   per message, the resolved provider and model, and the exit code.
6. **Ork's tools reach the model, beside the guard. Ran.**
   `cd "$W" && OMP_MCP_REQUIRE_READY=1 OMP_MCP_TIMEOUT_MS=0 ORK_OMP_MCP_AUTH="Bearer probe" omp -p --mode json $CLEAN --trusted-extension "$O/guard.ts" --plugin-dir "$O/plugin" --tools read,edit,write,bash,grep,glob --model "$M" --max-cost 0.50 "Call the report tool with status done." </dev/null; echo "exit $?"`
   Whether the model calls `mcp__ork_report` and how the events print it; a call
   that waits two minutes at the stand-in, for `delegate`'s timeout; then, with
   the stand-in stopped, whether the leg exits 1 before any model request (a
   wrong answer here spends one short turn).
7. **The token and the agent's shell. Ran.**
   `cd "$W" && ORK_OMP_MCP_AUTH="Bearer probe" omp -p --mode json $CLEAN --model "$M" --max-cost 0.50 "Run the shell command 'env | grep -c ORK_OMP_MCP_AUTH' and answer with the number it prints." </dev/null`
   Whether a variable of the leg reaches a shell command.
8. **Resume and fork. Ran.** With `ID` the session id of step 5:
   `cd "$W" && omp -p --mode json $CLEAN --model "$M" --max-cost 0.50 --resume "$ID" "Which file did you create?" </dev/null`
   and
   `cd "$W" && omp -p --mode json $CLEAN --model "$M" --max-cost 0.50 --fork "$ID" "Which file did you create?" </dev/null`
   Whether 18.22.2 accepts `--fork` (it is not in `omp --help`); whether the
   resumed leg prints the same id and the fork a new one; whether the flags, the
   overlay, the guard and the MCP server hold when passed again; whether
   `--append-system-prompt` on a resumed or forked leg takes; and what
   `--resume` does when the id is unknown (exit code, no prompt on a terminal).
9. **The handler refuses, and the model reads why. Ran.**
   `cd "$W" && ORK_OMP_MCP_AUTH="Bearer probe" omp -p --mode json $CLEAN --trusted-extension "$O/guard.ts" --plugin-dir "$O/plugin" --model "$M" --max-cost 0.50 "Run the shell command 'echo forbidden'. If it is refused, say why. Then read the file a.txt, and call the report tool with status done." </dev/null`
   The event a refused call leaves, the reason the model reports, and
   `$O/calls.jsonl`: which tools the handler saw (`bash`, `read`, the MCP call)
   and their inputs. Again with a handler that waits 40 seconds, for the timeout
   and for holding a paused call.
10. **`omp`'s own approvals in print mode. Ran.**
    `cd "$W" && omp -p --mode json $CLEAN --approval-mode always-ask --config "$O/rules.yml" --model "$M" --max-cost 0.50 "Run 'echo allowed', then run 'echo other', then create b.txt." </dev/null`
    with `rules.yml` allowing only `echo allowed` in `bash.patterns`: which
    calls run, which are refused and how the events say so; whether a read asks
    in `always-ask-cached`; whether `tools.restrictedFolders` refuses a `read`
    of a file in it.
11. **Usage, the cap and side requests. Ran, with lower caps.**
    `cd "$W" && omp -p --mode json $CLEAN --model "$M" --max-cost 0.01 "Count from 1 to 400, one number per line." </dev/null; echo "exit $?"`
    Exit 3 and the `cost-gate` line; then
    `grep -rc '"model_usage"' "$O/sessions"` and compare what the session files
    record with step 5's summed `usage`, to learn whether side requests are
    missing from the lines.
12. **Errors. Ran.**
    `cd "$W" && omp -p --mode json $CLEAN --model "nosuch/model" "hi" </dev/null; echo "exit $?"`
    The line and exit code of a model the account refuses, for
    `model_unavailable`. Authentication, rate-limit and credit errors are not
    provoked.
13. **One RPC turn. Not run** (for the later RFC on long-lived protocol drivers;
    not needed to build decision 1).
    `cd "$W" && omp --mode rpc --no-ui $CLEAN --model "$M" --max-cost 0.50`,
    then on stdin a `prompt` that runs `sleep 20`, a `steer` while it runs, an
    `abort`, and `get_state`; once without `--no-ui` and with
    `--approval-mode always-ask`, to read the approval request and answer it;
    once with `set_host_tools` and a prompt that calls the host tool.
14. **Processes left behind. Ran after the free steps and again after the paid
    ones.** `omp ps; pgrep -x omp`: whether a leg leaves a daemon, a language
    server or a background job running after it exits, and whether
    `launch.persist` can be turned off in print mode
    ([ADR-087](../../decisions/ADR-087-node-processes-end-with-ork.md)).
15. **The doctor check. Ran with the network on.**
    `time omp models --json >/dev/null`, and once more with the network off:
    whether it answers from its cache or waits.

Questions that are not for the spike, and stay open for later:

- Whether `ork onboard` should offer a driver that its built-in workflows refuse
  (they set `maxTurns`); the same question L454 leaves open for `codex`.
- Whether the later RFC for long-lived protocol drivers should weigh ACP (three
  of Ork's tools speak it) beside `omp` RPC and `codex app-server`.

## Spike, free steps, 2026-11-19

Run by the maintainer's agent, on the maintainer's approval, with `omp` 18.22.2
in a scratch git repository outside this one, and a stand-in for Ork's MCP
endpoint that logs each request's method, path and `Authorization` header. No
prompt reached a model: the print-mode runs used an empty agent folder (no
login), and the runs in the user's own folder sent one RPC `get_state` and
nothing else. Nothing was signed in or out, no credential file was read, and
`omp`'s configuration was not changed. Each answer names its step; a run beyond
the step's own command is called a variant. Steps 5 to 13 were not run.

1. **Step 1: no login.** The leg exits 1 with nothing on stdout and
   `No default model selected. Use /login, set an API key environment variable, or select a local model with /model or --model.`
   on stderr; no session file is written. So there is no header line to read
   without a login, and its shape stays with step 5. `--mode rpc` ends the same
   way, before any `ready` frame. Every flag of `$CLEAN` and the overlay were
   accepted. Found on the way: an unknown flag exits 2 with
   `Error: unknown flag: …`, and a missing overlay exits 1 with
   `Config overlay not found: …`.
2. **Step 2: what a session loads.** In the user's own folder, counts and kinds
   only:
   - _With no flags_ (variant, with `--no-session`): 11 tools are offered
     directly (`read`, `bash`, `edit`, `eval`, `glob`, `grep`, `task`, `wait`,
     `todo`, `web_search`, `write`); 77 slash commands, of which 48 are
     built-in, 24 come from skills, 3 are custom and 2 are `omp`'s own (they
     remain under the flags below); the system prompt's first part is about
     9,900 characters, with a skills section and a section of `xd://` devices.
   - _With `--no-extensions $CLEAN`:_ 50 commands (the built-in ones and `omp`'s
     own two), so the skills and the custom commands are gone, and so is the
     skills section; the first part is about 6,600 characters. With
     `tools.xdev: false`, `ast_edit` and `debug` become tools (13 in all) and
     the devices section is gone. `eval` and `task` are still offered, although
     the overlay sets `tools.approval` to `deny` for both.
   - _Adding `--tools read,edit,write,bash,grep,glob`:_ exactly those six; the
     prompt's delegation and browser parts go with the tools, leaving about
     5,800 characters and a short block naming the OS, the architecture and the
     model.
   - The session took its model and thinking level from the user's
     configuration, since the command named none. No MCP tool of the user's
     appeared in any of the three; whether this machine has any configured for
     `omp` was not looked at. The scratch repository has no `AGENTS.md`, so
     context files were not measured. A session that gets no prompt writes no
     session file.
3. **Step 3: the guard.** 18.22.2 accepts `--trusted-extension`, though
   `omp --help` does not list it. The guard's factory ran (it wrote its marker)
   before `omp` looked for a model. A guard that throws ends the process with
   `Trusted extension failed to load: …`, and a missing file with
   `Trusted extension must be an existing module file: …`, both exit 1 and both
   before the no-model error. The same throwing module passed by `-e` prints
   `Failed to load extension …` and the process goes on. `--trusted-extension`
   with `-e` exits 2:
   `--trusted-extension cannot be combined with --extension, -e, or --hook`.
   Exit 1 therefore has at least three meanings (no model, the guard failed, the
   overlay is missing), told apart only by stderr. Variants, in the user's
   folder: an RPC session starts with the trusted guard loaded; a tool the guard
   registers with `pi.registerTool` and a plain JSON Schema as `parameters` is
   offered under its own name with `tools.xdev: false`, also beside a `--tools`
   list, and is not offered with `tools.xdev: true`.
4. **Step 4: Ork's server.** With `-e "$O/pkg"` the stand-in received
   `initialize`, `notifications/initialized`, a `GET` and `tools/list`, each
   with `Authorization: Bearer probe`: the package's `mcp.json` loads under
   `--no-extensions`, and a header that names an environment variable takes its
   value. `omp` connects before it fails for want of a model. With the stand-in
   stopped the leg ends with the same no-model error, so whether
   `OMP_MCP_REQUIRE_READY=1` stops a leg could not be told without a login.
   Variants:
   - _A plugin folder._ `--plugin-dir "$O/plugin"` loads the server of its
     `.mcp.json`, and is accepted together with `--trusted-extension` (the guard
     loaded in the same runs). The header takes the variable's value written as
     `ORK_OMP_MCP_AUTH` and as `${ORK_OMP_MCP_AUTH}`. A root `plugin.json` with
     a root `mcp.json`, tried in the same folder, did not connect.
   - _In a session_ (the user's folder, `get_state` only, the package form): the
     tool is offered as `mcp__ork_report` with `tools.xdev: false`, and stays
     beside `--tools read,edit,write,bash,grep,glob`. With `tools.xdev: true`,
     `omp`'s default, it is not offered as a tool; the prompt names it as
     `xd://mcp__ork_report`.
5. **Step 14: processes.** After the free steps `omp ps` reports no processes
   and no broker for the scratch project, and no process is named `omp`. No turn
   ran, so this says nothing yet about what a real leg leaves; `pgrep -fl omp`
   as first written matched unrelated programs and is now `pgrep -x omp`.
6. **Step 15: the doctor check.** `omp models --json` took between 0.2 and 0.4
   seconds over three runs in the user's folder and 0.2 seconds with an empty
   one. The network was on, as instructed; the offline case is not measured.

What the free steps change:

- **Decision 2.** A fifth option, 2E, was found and measured, and is now the
  recommendation: it alone gives Ork's MCP server and a fail-closed guard in one
  leg. `tools.xdev: false` is required, not optional: with the default, Ork's
  tools are not tools.
- **Decision 3.** The guard's loading is measured and fails closed, which was
  the condition on 3C. `--tools`, not a `tools.approval` deny, is what removes
  `eval` and `task`.
- **Decision 4.** The flags remove the user's skills and custom commands. A node
  with no model would run on whatever the user configured.
- **The decoder.** A leg's end kind must read stderr: exit 1 covers a missing
  login, a guard that did not load and a missing overlay.
- **Still unknown,** all of it for the paid steps: every JSON line of a turn,
  usage and cost, resume and fork, whether a refusal reaches the model, whether
  a plugin's tool can be called, whether a server that is down stops the leg,
  and what the user's extensions, rules and context files add to a session.

## Spike, paid steps, 2026-11-19

Run by the maintainer's agent, on the maintainer's approval of the per-leg steps
under a cap of 5 dollars, with `omp` 18.22.2 and the model
`anthropic/claude-haiku-5-5` (a small, fast model among the cheapest the login
lists; the single cheapest was not taken because the list does not say whether a
model can call tools). Every leg ran in a scratch git repository outside this
one, against the stand-in for Ork's MCP endpoint, with the fixed prompts of the
step list, `--tools read,edit,write,bash,grep,glob` and a `--max-cost` of 0.25
or less. Fifteen legs reached a model and three ended before any request.
**`omp` reported 0.0080 dollars spent in all.** No transcript or session file is
kept. Step 13 was not run.

Changes to the listed commands: `--no-extensions` (or the guard) and the six
tools on every leg, as a driver's leg would have; `--thinking low` from step 6
on; step 11 with lower caps, because this model is too cheap to reach 0.01.

1. **Step 5: the JSON lines of a turn.** One JSON object a line, nothing on
   stderr, exit 0, about three seconds for a short turn.
   - The first line is the header:
     `{"type":"session","version":3,"id":"<uuid>","timestamp":…,"cwd":…}`. Its
     `id` is the session id.
   - Then `agent_start`, and per model request `turn_start`, `message_start`,
     `message_update` (deltas), `message_end`, `turn_end`; per tool call
     `tool_execution_start` (`toolCallId`, `toolName`, `args`, `intent`),
     `tool_execution_update` and `tool_execution_end` (`result.content`,
     `isError`), with the result again as a `message_end` of role `toolResult`.
     The built-in tools are named `bash`, `read`, `write`, `edit`, `grep` and
     `glob`.
   - Each assistant `message_end` carries `provider`, `model`, `stopReason`
     (`toolUse` or `stop`) and `usage`: `input`, `output`, `cacheRead`,
     `cacheWrite`, `totalTokens` and `cost` (the same four and `total`, in
     dollars). So usage and cost come once per model request, during the leg.
     The message also carries a `credentialId`, which Ork has no use for and
     should not record.
   - There is no result line. The leg ends with `agent_end` (`isTerminal`,
     `yielded`, and every message again), and the answer is the text of the last
     assistant message.
   - Other lines seen: `advisor_cost_changed`, `thinking_level_changed`, and
     `notice` (below).
   - With `--session-dir`, the session is `<timestamp>_<id>.jsonl` directly in
     that folder, with a folder of the same name beside it and a lock file that
     stays after the leg. Nothing is written in the checkout.
   - `--append-system-prompt` took on a first leg.
2. **Step 6: Ork's tool.** With the plugin folder and the guard in one leg, the
   model called `mcp__ork_session_ork_report` (the plugin was named
   `ork-session`, the server `ork`, the tool `report`), the stand-in received
   `tools/call` with `{"status":"done"}` and the bearer header, and the result
   came back as the tool's result. A call the stand-in answered after two
   minutes was waited for (`OMP_MCP_TIMEOUT_MS=0`). With the stand-in stopped
   and `OMP_MCP_REQUIRE_READY=1`, the leg printed its header, then
   `Error: MCP servers not ready: ork-session:ork` on stderr, and exited 1 after
   a second with no model request.
3. **Step 7: the token and the shell.** `env | grep -c ORK_OMP_MCP_AUTH`, run by
   the agent, printed 1: a variable of the leg reaches the agent's shell.
4. **Step 8: resume and fork.** `--resume <id>` prints the same session id in
   its header and the model remembered the file it had created. `--fork <id>` is
   accepted by 18.22.2 and prints a new id, with `parentSession` naming the
   source. `--append-system-prompt` given on the resumed leg took there; for the
   fork the run does not tell. An unknown id ends at once, exit 1, nothing on
   stdout, `Error: Session "<id>" not found.` on stderr, and asks nothing.
5. **Step 9: the handler.** For `echo forbidden` the guard returned
   `{ block: true, reason: "refused by Ork" }`: the lines show
   `tool_execution_start` and then `tool_execution_end` with `isError: true` and
   the text `refused by Ork`, the model read it and said so, and the leg went
   on. So a refused call is on the lines, unlike Codex's. The handler saw `bash`
   (`command`), `read` (`path`) and the MCP call with their inputs, and `write`
   by name. A handler that waits 40 seconds was cut off at `omp`'s default: the
   call failed with `Extension … timed out after 30000ms` and did not run. With
   `extensionHandlers.toolCallTimeoutMs: 90000` in an overlay the same handler
   held the call for 40 seconds and then it ran.
6. **Step 10: `omp`'s own approvals in print mode.** With `always-ask` and one
   `bash.patterns` rule allowing `echo allowed`, that command ran, and
   `echo other` and a `write` were refused; the leg went on and exited 0. The
   refusal the model reads is
   `Tool "bash" requires approval but no interactive UI available.` followed by
   options that begin "Set tools.approvalMode: yolo". With `always-ask-cached` a
   `read` of a file is refused the same way. With `tools.restrictedFolders`
   naming the folder, both `bash` and `read` were refused with
   `Reason: Restricted folder: …`.
7. **Step 11: usage, the cap and side requests.** Caps of 0.01 and 0.001 were
   never reached: a whole turn of this model costs less. With a cap of 0.0001
   the first request went out, its tool calls ran, and then the leg printed
   `{"type":"notice","level":"error","message":"Cost cap reached: …","source":"cost-gate"}`,
   `agent_end`, and exited 3. One side request was found: on the one leg run
   without `--thinking`, the session file records a `model_usage` entry
   (`auto-thinking`, by the `judge` role, 468 tokens) that is on no JSON line,
   although `--no-judge` and `--offline` were passed. The legs run with
   `--thinking low` record none.
8. **Step 12: an unknown model.** `--model nosuch/model` ends at once, exit 1,
   nothing on stdout, `Model "nosuch/model" not found` on stderr, no request.
   This is a name `omp` does not know. A model the account refuses, and
   authentication, rate-limit and credit errors, were not provoked.
9. **Step 14: processes.** After all legs `omp ps` reports no processes and no
   broker for the scratch project, and no process is named `omp`. The scratch
   repository holds only the file the prompts created.

What the paid steps settle:

- **The decoder.** The session id is the first line's `id`; usage and cost are
  on each assistant `message_end`; the end is `agent_end` and the exit code (0,
  or 3 at the cost cap); a refused call is a `tool_execution_end` with
  `isError`. A leg that cannot start prints nothing or only its header on stdout
  and explains itself on stderr with exit 1: no login, an unknown model, an
  unknown session, an MCP server that is not ready, a guard that did not load, a
  missing overlay. So the leg's end kinds are read from stderr.
- **`price: true`,** and `budgetTokens` can stop a running leg, because usage
  comes per request.
- **`readDenies: true`** as far as `read` goes: the handler sees its path.
- **Decision 2,** option 2E, end to end; and the token belongs in the plugin's
  file, not the environment.
- **Decision 3,** option 3C: refusal, coverage, fail-closed timeout, and a held
  call (which `codex` could not do, G40).
- **Decision 5,** option 5A; and every leg passes `--thinking`.
- **The minimum version,** 18.22.2.

Still unmeasured, for the build and the gate run to answer:

- What the handler sees for `edit`, `grep` and `glob`; path-scoped rules; `read`
  of a URL, an archive or an internal address (`xd://`, `skill://`), and a
  `write` to `omp`'s own settings address.
- Whether a fork keeps the instructions of its source or takes new ones.
- A model the account refuses, and authentication, rate-limit and credit errors.
- Usage and cost on another provider, on a subscription login, and on a model
  whose price `omp` does not know.
- Stopping a leg from outside (`ork stop`, a `budgetTokens` stop): what `omp`
  does on a signal mid-turn, and whether the session can then be resumed.
- A background job or a service started by a turn, and whether `launch.persist`
  can be turned off in print mode (no fixed prompt starts one; the overlay turns
  background jobs off).
- What the user's own extensions, rules, context files and MCP servers add to a
  session, and how the repository's `AGENTS.md` is read.
- The node's own `.mcp.json` servers (`mcpServers`); a handler holding a call
  longer than 40 seconds; the doctor check with the network off.
- The RPC turn (step 13), and everything Ork's adapter adds: the gate run.
