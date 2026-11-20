# Limits found building the `codex` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G40 to G44 in [the register](../gaps.md#gaps) (G39
is closed by the [`codex-app-server` driver](../runtime/codex-app-server.md)).

Found building [the `codex` driver](../runtime/codex.md)
([RFC-024](../../rfcs/archived/RFC-024-codex-driver.md)) and on its gate run
(2026-11-18, codex-cli 0.169.0), which proved it. What was left simpler, or
could not be checked:

- **L438 · A Codex session sees the bundled skills and your own.** Codex has no
  way to turn skills off: the bundled ones and those in `~/.agents/skills` and
  `~/.codex/skills` stay visible by name and description, unlike a clean Claude
  Code session. Ork turns plugins, apps and remote plugins off (`--disable`) and
  ignores your config and rules. Revisit when Codex can turn skills off.
- **L439 · A session is kept in your Codex home.** Ork leaves it in
  `$CODEX_HOME/sessions` (no `--ephemeral`: a later leg resumes it, and a
  private `CODEX_HOME` would need your login copied, which Ork never does).
  Nothing prunes it.
- **L441 · A user or system hooks file refuses the node.** The trust bypass Ork
  needs for its own hook would run `$CODEX_HOME/hooks.json` (default
  `~/.codex/hooks.json`) or `/etc/codex/hooks.json` untrusted, so a node ends
  with a driver error, before any model call, while either exists. Ork checks
  that the file exists and never reads it, so it cannot tell a harmless one. A
  checkout's own `.codex/hooks.json` stays off as Codex's untrusted project
  configuration.
- **L442 · `OPENAI_API_KEY` does not count as a login.** `ork doctor` and the
  ready check read only the exit status of `codex login status`. Whether Codex
  reads the key in `exec` was never measured, so a machine with only the key is
  not seen as ready.
- **L443 · Codex reports tokens, never dollars.** `price` is `false` and
  `costUsd` is 0, so `budgetUsd` alone does not bind it (`ork validate` warns,
  as for `command-code`); Ork has no price table for OpenAI models.
- **L445 · Auth, rate-limit and credit errors are read by text.** The spike
  provoked only an unsupported model. Other failures go through the shared
  provider-error classifier on their `turn.failed` or `error` text, and an
  unknown one ends as a generic error with its text under Details.
- **L446 · A hook that did not load is found after the fact.** The leg's decoder
  ends the node (`driver_crashed`) at the first finished tool item with no hook
  call in the leg and the runner kills the leg's process there, but the calls up
  to that item ran inside the sandbox with no rules. Nothing cheaper exists
  without a model call.
- **L447 · What the sandbox writes besides the folder is unmeasured, and so is
  the hook's own file.** `workspace-write` may also allow Codex's temporary
  folders, and whether a shell command can write the hook's `calls.jsonl` (it is
  outside the checkout, mode 0600, but inside the user's account) was not
  checked. A node that rewrote it could hide a hook that never ran from the
  canary.
- **L448 · Two sessions started at once from one tools object share a hook
  entry.** The leg's decoder finds its session's hook by the node's `tools`
  object (a `WeakMap`), to avoid a change to the adapter interface; the later
  wins. Sessions of different nodes are unaffected. Pass the wiring to the leg
  decoder if it ever matters.
- **L449 · The hook command assumes a POSIX shell.** Codex runs the hook through
  a shell, and Ork quotes the script path for `sh` (`shellQuote`). That holds on
  macOS and Linux; it would break if Codex ran hooks through `cmd.exe` on
  Windows. Check it when Ork supports Windows.
- **L451 · A message sent during a Codex leg reads as none until the leg ends.**
  Codex takes nothing mid-turn, so Ork holds the message for the next leg
  (`exec resume`), and meanwhile `read_inbox` and `wait_for_messages` tell the
  agent "no message" while one waits (the gate run). Saying in those tools'
  answers that a message is held for the next leg would close it.
- **L452 · A call the hook refused is logged with no input.** `ork logs` shows
  it as `Bash {}`: the hook's record gives the decoder the tool's name only, so
  the log does not say which command was refused (the model reads it in the
  refusal). Recording the input in `calls.jsonl` would close it.
- **L453 · A tool run from Codex's code mode is logged as the inner tool.**
  Codex may run tools from its JavaScript `exec` cell (`tools.exec_command(…)`,
  `tools.mcp__ork__…`). The hook sees each call and holds the node's rules, but
  `ork logs` shows the inner tool, not that it came from code mode.
- **L454 · `ork onboard` and `ork:security-audit` are refused on `codex`.**
  Their built-in workflows set `maxTurns`, which `codex` cannot hold, so
  `ork run` refuses them before any session starts, while `ork onboard` still
  offers a ready `codex` among its drivers. Dropping the built-ins' `maxTurns`
  for the token caps, or not offering a driver the built-ins refuse, would close
  it.
