# Codex

_Part of [Drivers](../drivers.md)._

The `codex` driver runs your own `codex`
([OpenAI's Codex CLI](https://github.com/openai/codex), tried on 0.169.0),
headless: one `codex exec` process for each stretch of a session, in the node's
folder. It is **built but not proven yet**: Ork's tests pass against a stand-in
for `codex`, and the maintainer has not yet run it on a real session. Until then
`ork doctor` shows it as `skip`, no run picks it on its own, and `ork validate`
and `ork run` refuse a node that names it (`not yet proven on a real session`).
This page says what it will do, so you can see whether it fits.

## Setting it up

- Install Codex and sign in with `codex login`; Ork runs `codex login status`
  and reads only its exit status, and never reads Codex's own login files.
  `OPENAI_API_KEY` alone is not counted as a login.
- It needs Codex 0.169.0 or later; `ork doctor` warns about an older one.
- A node names it with `driver: codex`, `ork run --driver codex` or a model such
  as `codex.<model>`. A node with no model runs Codex's own default for your
  account; the model's name is passed to Codex as written.
- The node has to be in a git repository, as Codex requires. Ork does not ask
  Codex to skip that check.

## What it does

- A message or answer sent while Codex is working arrives when that stretch
  ends, and the session carries on from where it was (`codex exec resume`).
- It reports tokens and no dollars, so a node with only `budgetUsd` is warned
  about and does not stop on dollars; add `budgetTokens`. A token cap stops a
  session between stretches, as usage arrives at the end of each.
- Ork's tools (`ask_user`, `delegate`, messages, `report`) reach it. A node's
  own `mcp` servers, `agent.subagent` nodes and `maxTurns` are refused.
- `ork pause` and `ork stop` take effect when the current stretch ends, and a
  shell call does not take a `heavy` slot.
- Codex's own web search is not turned off. Ork keeps its sandbox's network off,
  but a node that must not search the web should run elsewhere.

## What holds a node to its rules

Codex never asks you, so the node is **denied unless allowed**, as on
`open-code` and `command-code`
([permissions](../drivers.md#permissions-denied-unless-allowed)). Two things
hold it:

- **Codex's sandbox.** A node in `plan` mode, or whose `allow` has no `Bash`,
  `Edit` or `Write`, runs read-only; so does a node whose `tools.only` names
  none of them, even under `--yolo`. Any other node, `--yolo` too, can write
  only in its folder. The network is off.
- **A hook Ork writes for the session.** It checks each shell command, patch and
  tool call against the node's `allow`, `deny` and `only` lists, in Claude
  Code's words, and refuses what is not allowed with a reason the model reads;
  the run's output shows each refusal as a failed tool call. A shell line is
  checked command by command, as on `command-code`. Ork's own tools always pass.
  A call Ork can't name is refused, even under `--yolo`. The hook's files are in
  a private folder outside your project, and go when the session ends.

Reading is not gated: Codex has no read tool, and its sandbox can read outside
your folder, so a shell command may read files elsewhere. `ork validate` and
`ork run` **refuse** a node that denies `Read`, `Glob` or `Grep` on a path,
since the deny could not hold. A node that reads through
[`extract`](../../../specs/runtime/extract-tool.md) is steered to it.

## If a node stops before it starts

**`… exists: Ork runs its own Codex hook …`.** Ork's hook runs on every Codex
call with Codex's `--dangerously-bypass-hook-trust`, which would also run a
hooks file of yours untrusted. So a node ends, before any model call, when
`~/.codex/hooks.json` (or `$CODEX_HOME/hooks.json`) or `/etc/codex/hooks.json`
exists. Ork only checks that the file is there. Move it away to run on `codex`.
A project's own `.codex/hooks.json` stays off, as Codex treats an untrusted
project.

**`Codex ran tool calls without Ork's hook …`.** The node's rules were not
applied to a call, so Ork ended the node. Check that nothing else sets Codex's
hooks. The first calls ran inside Codex's sandbox before Ork saw it.

## What a Codex session loads

Ork starts Codex with your own config and rules ignored and with plugins and
apps off. Codex still reads the project's `AGENTS.md`, and it still shows the
skills it ships with and your own (`~/.agents/skills`, `~/.codex/skills`) by
name and description, unlike a clean Claude Code session. Codex keeps the
session in its own `$CODEX_HOME/sessions`; Ork does not clean it. A new session
started at about 19,000 input tokens with plugins off.

The register has what is left open:
[the codex limits](../../../specs/gaps/codex-limits.md) and G39 to G44 in
[the gaps](../../../specs/gaps.md#gaps). Why Ork does it this way:
[ADR-102](../../../decisions/ADR-102-codex-driver.md).
