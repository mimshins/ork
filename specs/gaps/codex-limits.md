# Limits found building the `codex` driver

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.
The gaps found with them are G39 to G44 in [the register](../gaps.md#gaps).

Found building [the `codex` driver](../runtime/codex.md)
([RFC-024](../../rfcs/archived/RFC-024-codex-driver.md)), which is not proven
until the maintainer's gate run. What was left simpler, or could not be checked:

- **L438 · A Codex session sees the bundled skills and your own.** Codex has no
  way to turn skills off: the bundled ones and those in `~/.agents/skills` and
  `~/.codex/skills` stay visible by name and description, unlike a clean Claude
  Code session. Ork turns plugins, apps and remote plugins off (`--disable`) and
  ignores your config and rules. Revisit when Codex can turn skills off.
- **L439 · A session is kept in your Codex home.** Ork leaves it in
  `$CODEX_HOME/sessions` (no `--ephemeral`: a later leg resumes it, and a
  private `CODEX_HOME` would need your login copied, which Ork never does).
  Nothing prunes it.
- **L440 · A node outside a git repository is refused by Codex.** Ork never
  passes `--skip-git-repo-check`, matching what was measured and keeping Codex's
  own guard. Every worktree node is in a repository; a node outside one was not
  tried. Try one, then decide whether the flag is warranted.
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
- **L444 · The cached part of `input_tokens` is assumed.** Ork subtracts
  `cached_input_tokens` from `input_tokens` to count input, taking OpenAI's
  convention that the first includes the second. The spike listed the fields and
  did not check that. If it is wrong, input reads low. The gate run confirms it.
- **L445 · Auth, rate-limit and credit errors are read by text.** The spike
  provoked only an unsupported model. Other failures go through the shared
  provider-error classifier on their `turn.failed` or `error` text, and an
  unknown one ends as a generic error with its text under Details.
- **L446 · A hook that did not load is found after the fact.** The leg's decoder
  ends the node (`driver_crashed`) at the first finished tool item with no hook
  call in the leg, but the first calls ran inside the sandbox with no rules.
  Nothing cheaper exists without a model call.
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
