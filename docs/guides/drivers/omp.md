# omp

_Part of [Drivers](../drivers.md)._

The `omp` driver runs your own `omp`
([oh-my-pi](https://github.com/can1357/oh-my-pi)'s coding agent, built against
18.22.2), headless: one long-lived `omp --mode rpc` process for each stretch of
a session, in the node's folder, which Ork talks to in both directions. It
reaches whatever model providers your `omp` is signed in to. It is **built and
not yet proven**: no real session has run through it with Ork's tools, guard and
budgets, so `ork validate` and `ork run` **refuse** a node on `omp`
(`node … runs on driver omp, which is not yet proven on a real session`) and
`ork doctor` shows it as `skip` even when `omp` is installed and signed in. A
capped run on the maintainer's account will lift that; until then this page says
what the driver is built to do.

## Setting it up

- Install `omp` and sign in with `omp login`. Ork has no status command to call:
  `ork doctor` runs `omp models --json`, counts the models your logins reach
  (`logged in (12 models)`) and shows only that number, never a key. On a fresh
  home that command can take about 15 seconds.
- It needs `omp` 18.22.2 or later; `ork doctor` warns about an older one.
- A node names it with `driver: omp`, `ork run --driver omp` or a model such as
  `omp.<model>`. What follows `omp.` goes to `omp --model` as written: a fuzzy
  name (`omp.opus`), an exact `provider/model` (`omp.openai/gpt-5.2`) or a role
  you set up in `omp`. A fuzzy name or a role can resolve to different models on
  two machines. A node with no model runs `omp`'s own default.
- `effort` becomes `omp --thinking` (`low`, `medium`, `high`, `xhigh`, `max`),
  and a node that sets none runs at `medium`. Ork never passes `auto`.
- Your own `omp` setup and login are used: `OMP_PROFILE` or
  `PI_CODING_AGENT_DIR` in your shell pick the login for the doctor and for
  every session alike. Ork sets neither.

## What it does

- A message sent while `omp` is working (`ork chat`, `ork send`) reaches the
  model before the turn ends: Ork writes it to the running process as a steering
  message. A tool call that is running finishes first, and the model reads the
  message after it, so "before the turn ends" is not "at once". A leader's
  question to you is a fork of the session (`--fork`).
- Each stretch starts a new `omp` process, and `omp` takes 10 to 25 seconds to
  say it is ready (measured on a fresh home), so a stretch that resumes pays
  that again.
- Ork's tools (`ask_user`, `delegate`, messages, `extract`, `report`) reach it
  through a private plugin that carries Ork's tool server. A node's own `mcp`
  servers, `agent.subagent` nodes and `maxTurns` are refused, so `ork onboard`
  and `ork:security-audit`, whose workflows set `maxTurns`, do not run on `omp`.
- It reports dollars and tokens
  ([what the dollars mean](#what-the-dollars-mean)).
- A node is
  [denied unless allowed](../drivers.md#permissions-denied-unless-allowed):
  Ork's settings list every tool the node's rules allow, and the guard refuses
  the rest. A call `omp` still asks about, for a tool those settings do not
  list, comes to you as a permission question in `ork decide`, with the tool and
  its arguments, as on `claude-code`. Allow answers `Approve` and deny answers
  `Deny`. Ork never sends `omp`'s "approve for this session", so each call is
  asked again. A question Ork cannot read is answered as a cancel, never as an
  allow.
- The report goes through Ork's `report` tool.
- `omp`'s own `eval` and `task` tools are never offered, and its background
  jobs, advisor, prewalk, model fallback, automatic update and memory are off.

## What holds a node to its rules

`omp` has no sandbox, so three things hold a node:

- **Which tools it is offered.** Of `omp`'s six built-in tools (`read`, `edit`,
  `write`, `bash`, `grep`, `glob`), a node gets only those its `allow`, `deny`,
  `only` and `plan` mode can permit some call of; every other one is refused by
  `omp`'s own settings, which Ork writes for the session.
- **A guard Ork writes for the session.** It checks each call against the node's
  `allow`, `deny` and `only` lists, in Claude Code's words, before it runs, and
  refuses what is not allowed with a reason the model reads; the run's output
  shows each refusal as a failed tool call. A shell line is checked command by
  command, as on `command-code`. Ork's own tools pass unless the node denies
  them. A call Ork can't name is refused, even under `--yolo`.
- **The worktree.** The guard refuses an `edit` or `write` outside the node's
  folder, or one it can't read a path from, even under `--yolo`. It also refuses
  an address with a scheme (such as `https://…`) and anything in Ork's private
  folder. Reading a file outside the folder needs a rule.

A shell command the node's rules allow runs with your rights; the guard cannot
fence it. A `deny` on a `Read`, `Glob` or `Grep` path is **accepted**, unlike on
`codex`: all three read tools are then withheld, and the node reads through
[`extract`](../../../specs/runtime/extract-tool.md), which applies the path
patterns in Ork's process. Under [`reading: extract`](../project-rules.md) a
shell line that starts by reading files is refused with the `extract` call to
make.

## Pausing and stopping

- **`ork pause`.** The node's next call waits, in the same stretch, until you
  `ork continue`; then it runs. A `heavy` command also waits there for its slot.
  Nothing prints while a call waits.
- **A long pause.** A call waits up to 9 minutes, the same window as
  `claude-code`. If the node is still paused, Ork ends that stretch (it tells
  `omp` to stop, then closes it), and `ork continue` starts a new one that
  resumes the session (`omp --mode rpc --resume`) with one message asking the
  model to make the held call again (any other resume, such as after
  `ork resume` or a late message, sends the node's own prompt, as on every
  driver). A pause of any length costs one resume, with a cold prompt cache, not
  one model request for each window. The session's usage across both stretches
  is added up for the node's budgets. The resume waits for `omp`'s start-up
  (above) and for a `heavy` slot if the call needs one.
- **`ork stop`.** A held call never runs: the session ends `interrupted`, with
  no report. Ork tells `omp` to abort, then closes it and ends the process if it
  is still running after a short wait. A stop while the stretch is ended at a
  long pause never resumes it. The request that made the held call is not
  counted: its usage is only printed after the call is answered.

This path, resuming after an abort with Ork's session folder, has not yet run on
a real `omp`; see [the omp limits](../../../specs/gaps/omp-limits.md).

## If a node stops before it starts

`omp` exits at once, before any model request, when what Ork gave it is wrong.
The node ends with the line `omp` printed:

**`Trusted extension failed to load …`, `Config overlay not found …`.** Ork's
guard or its settings file for the session could not be read, so nothing ran.
Run again; if it repeats, report it.

**`No default model selected`.** `omp` is not signed in, or has no model. Run
`omp login`, or name a model.

**`Model "…" not found`.** The `omp.<model>` name matches nothing for your
logins; run `omp models` to see what does.

**`Session … not found`.** `ork resume` found no session file; they are kept in
`~/.ork/omp/sessions/` ([where Ork keeps things](../where-ork-keeps-things.md)).

**`MCP servers not ready`.** Ork's tool server did not answer, so the stretch
ended instead of running without Ork's tools.

**`unknown flag`.** Your `omp` is older or newer than the one Ork was built
against. Update `omp`, or report it.

**`omp did not say it was ready within 45 s`.** `omp` did not finish starting
within Ork's limit (it has taken up to 25 seconds), so the node ends. Run again;
if it repeats, run `omp` by hand.

**`omp sent a frame in chunks …`.** `omp` split one message above its frame
limit (1 MiB), and Ork cannot read a split message yet, so the stretch ends
instead of reading half of it. Report it with what the node was doing.

## What an omp session loads

Ork starts `omp` with its skills, rules, title generation, language servers,
terminal shells, prewalk, judge and spotlight off, and with other tools' files
(Claude, Codex, Cursor and the like) and their MCP servers left out. It still
reads the project's `AGENTS.md` and the rest of **your own** `omp` setup for
settings Ork does not name, such as your model roles. Ork's own instructions are
passed on every stretch, since `omp` does not keep them when a session resumes.

Ork keeps what it makes for the session in a private folder outside your project
(mode `0700`, files `0600`), including a copy of its token, and removes it when
the session ends. `omp` keeps its session files, whole transcripts, in
`~/.ork/omp/sessions/`, and Ork keeps a small ledger of what each session has
spent in `~/.ork/omp/spent/`. **Neither is pruned**: delete them yourself when
you no longer resume those sessions.

## What the dollars mean

`omp` reports a cost for each model request, from its own price list, so
`budgetUsd` works. Two limits:

- The dollars are catalogue prices. A subscription login gets notional dollars,
  and a model `omp` has no price for counts as $0, so `budgetUsd` alone does not
  stop it there: add `budgetTokens`.
- `omp`'s cap counts the whole session, so Ork passes it what the session had
  spent (by its ledger) plus the node's `budgetUsd`: a resumed stretch gets its
  own budget, as on the other drivers. A request in flight can pass the cap, and
  the node ends `budget_limit`. If the ledger entry is gone, a resumed session
  gets no credit for what it spent and may stop at once.

The register has what is left open:
[the omp limits](../../../specs/gaps/omp-limits.md). The contract:
[specs/runtime/omp.md](../../../specs/runtime/omp.md). Why Ork does it this way:
[ADR-105](../../../decisions/ADR-105-omp-driver.md).
