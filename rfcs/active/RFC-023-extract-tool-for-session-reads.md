# RFC-023 — An extract tool for what sessions read: Code Mode without running code

- **Status:** Accepted
- **Date:** 2026-11-17
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)

## Context

Ork's cost is mostly cache reads of growing transcripts: 97% of all input tokens
in the published benchmarks were cache reads
([benchmarks/README.md](../../benchmarks/README.md)). A tool result a session
reads once is read again, from cache, on every later turn. The way to cut that
cost is to keep raw results out of the transcript.

**The idea.** Code Mode, as the brief describes it: instead of calling tools one
at a time and rereading every raw result, the model writes one short program
that calls the tools, filters and chains their results in code, and returns only
what it needs. Two sources:

- Claude Code's Code Mode (<https://code.claude.com/docs/en/code-mode>):
  experimental, switched on by `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`, from
  v2.1.323, in the interactive terminal only: not `-p`, not the Agent SDK.
- Cloudflare's `@cloudflare/codemode`
  (<https://developers.cloudflare.com/agents/tools/codemode/how-it-works/>): one
  `codemode` tool, search and describe calls to keep the catalog out of context,
  approvals by pause and replay, saved snippets.

Both were taken from the brief; this RFC did not re-read them.

**Why Ork cannot just switch it on.** The `claude-code` driver runs
`claude -p --input-format stream-json`
([claude-code.ts](../../packages/runtime/src/adapters/claude-code.ts), the
`buildCliArgs` function), so Claude Code's own Code Mode is not available to Ork
sessions today. `open-code` and `command-code` have nothing like it
([drivers.ts](../../packages/integrations/src/drivers.ts)).

**What sessions carry.** Measured on 88 Claude Code sessions of four recent
build runs (f7f49775, 8d0a6287, 3867d943, aedbdc3d). Each tool result is
weighted by characters times the number of later turns that reread it, a proxy
for cache-read cost, not a cost.

| Cut     | Share of carried weight                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| By role | implement 65%, review 21%, engine 11%, the build leader 2%                                                           |
| By kind | reading files through the shell (`cat`, `sed`, `head`) 53%; the Read tool 10%                                        |
|         | searching through the shell (`rg`, `grep`, `find`, `ls`) 14%; `git diff`, `show`, `log` 10%                          |
|         | tests and checks 5% (Ork already keeps suites out of builders, `heavy` in `.ork/project.yaml`); Ork's MCP tools < 1% |

More from the same measurement:

- Shell reads, shell searches and git diffs add to 77%; with the Read tool, 87%.
  That is the weight an extract tool could reach, not what it would save: a
  result that is the extract is still carried.
- The leader made 60 Ork tool calls in 331 turns (29 `delegate`, 16
  `spawn_worker`, 12 `read_input`, 3 `ask_user`). They are 44% of the leader's
  own carried weight, but the leader is 2% of the total.
- Worker sessions average 97 turns (median 66). 633 file reads averaged 4.3k
  characters, half of them a whole-file `cat`. Rereads of a file already read
  are 24% of reads but 3% of the carried read weight.

**What constrains the design.**

- Ork has no OS-enforced sandbox
  ([security audit](../../runbook/development/security-audit.md): "Nothing
  audited is run: Ork has no OS-enforced sandbox yet"). Running code a model
  wrote is the hard part of any Code Mode.
- Ork's own MCP tools reach all three drivers through one registry
  ([registry.ts](../../packages/runtime/src/tools/registry.ts), `ORK_TOOLS`),
  and `read_input` ([ADR-078](../../decisions/ADR-078-read-input.md)) is the
  precedent for a tool that returns bounded pages of text.
- A driver's permission rules are its own: the `claude-code` driver asks Ork
  through `--permission-prompt-tool`, the other two have
  `permissionPrompt: false` and Ork supplies a rule set
  ([drivers.ts](../../packages/integrations/src/drivers.ts)). A tool Ork serves
  is not inside those rules, so it must keep to what they would allow.
- A tool does not know its session's folder today: `ToolContext` carries
  `nodeId`, `driver`, `ports` and the report, while `cwd` sits on `SessionSpec`
  ([types.ts](../../packages/core/src/runtime/types.ts)).

## Options

### Option 1 — Pass Claude Code's Code Mode through

A per node or per project switch that sets the environment variable once `-p`
supports it. Until then, a follow-up that waits.

- **Pros:** Ork writes and runs no code-executing code; Anthropic owns the
  sandbox and the model's training for it; nothing for Ork to secure.
- **Cons:** not available today (interactive terminal only), so it cannot be
  built or measured now; one driver only; the node's tool calls move inside a
  program Ork cannot see event by event, which matters to the permission prompt,
  the heavy-call slot
  ([heavy-hook.ts](../../packages/runtime/src/heavy-hook.ts)) and the pause
  hold, all of which act at a tool call; experimental, so its behavior may
  change under Ork.

### Option 2 — An Ork MCP tool that extracts reads, searches and diffs

One tool, offered to every session on every driver. It takes a short list of
helper steps (read a line range, search, show a git diff, filter or cut the
result) and returns only the extract. It targets the measured 77% to 87%.

- **Pros:** works on all three drivers; aims at where the weight is; reads only,
  so it can sit inside what a read-only node may do; the result and its size are
  Ork's own, so Ork can count them and measure adoption; fits the registry
  pattern (a new tool is one file and one line).
- **Cons:** it only helps if the model chooses it over `cat` and `rg`, which Ork
  can steer but not force; a new surface to contain (paths, secrets, size); must
  honor each driver's permission rules by hand; a tool call still costs a turn,
  so a model that calls it then `cat`s the file is worse off.
- **Variant 2a — declarative helper calls:** the tool takes a list of steps Ork
  runs itself. No model-written code runs, so no sandbox is needed. Chaining is
  limited to what the step language offers.
- **Variant 2b — a short JavaScript program:** closest to Code Mode, with loops
  and free chaining. Needs an isolate or an OS sandbox Ork does not have
  (`node:vm` is not a security boundary), probably a new dependency or process
  boundary (an ADR, and the supply-chain rules in [AGENTS.md](../../AGENTS.md)),
  and an answer for what the program may reach.

### Option 3 — Coordination as code for leaders

The leader writes one program that spawns, waits, reads reports, picks and sends
in a single run.

- **Pros:** safe, since it reaches only Ork's own verbs; would cut the leader's
  60 calls in 331 turns.
- **Cons:** the leader is 2% of the carried weight, and Ork's tools under 1%;
  the best case is a few percent of the total.

### Option 4 — Snippets as deterministic steps

When an agent node keeps running the same commands, suggest turning them into a
`tool.shell` step.

- **Pros:** fits the deterministic-first rule and the feedback loop; the saving
  is total for what it catches (the model is not in that step).
- **Cons:** only helps commands that repeat; the measured weight is mostly
  one-off reads of different files, so little of it is a repeated command (not
  measured); needs a detector and a suggestion flow.

### Option 5 — Not Code Mode: shorter sessions or smaller tasks

Plan builds in smaller tasks or cap turns, so a read is carried for fewer turns.

- **Pros:** driver-neutral; no new surface; cache reads grow with the length of
  the transcript, so it reaches all of the weight, not 77%.
- **Cons:** changes how builds are planned and may add briefs, startup and
  integration work (a fresh session pays to read the same files again); does not
  shrink any single read. Its cost was not measured.

## Decision

**Option 2, variant 2a:** an Ork MCP tool that runs a list of read-only helper
steps in-process and returns only the extract. The first version runs no
model-written code. Options 4 and 5 are complements, not rivals: they are kept
as follow-ups that need no decision here.

What the first version is:

- **One tool**, registered in `ORK_TOOLS` like `read_input`, offered to every
  session of every driver, named in the session's brief and context as the way
  to read a part of a file, search and look at a diff.
- **Steps, not code.** A call is a short list of steps from a fixed set: read a
  line range of a file, search a folder or file (a literal or a regular
  expression, with a match cap), show a `git diff`, `show` or `log` (read-only,
  with a size cap), and cut a step's output (first or last lines, lines matching
  a pattern). A step can take the previous step's output. The set is not
  extended by a call.
- **Returns only the last step's output**, capped, with where it was cut and how
  to ask for the rest (the way `read_input` does), so a session can always get
  more but never gets more than it asked for.
- **Path containment.** Every path resolves, with symlinks followed, inside the
  session's own folder (the `cwd` of its `SessionSpec`, which the tool is given
  for this). A path outside it, and Ork's private session folder
  ([secret-file.ts](../../packages/runtime/src/secret-file.ts)), is refused. A
  file a driver's own rules would refuse to read is refused too (how the tool
  knows is an open question below).
- **No process the model can shape.** The tool runs `git` with its own fixed
  arguments, never a shell, and never with a value from the call put into a flag
  position.
- **Pause and hold.** A call is a tool call: it honors a paused run or node at
  its start, as other Ork tools do.
- **Counted.** Each call records what it read and returned (characters), so a
  benchmark can tell whether sessions used it and how much it cut.

A program runner (variant 2b) is not built, and not rejected for ever: it
returns only if the benchmark below shows that the step language is what limits
the saving. It then needs its own RFC and ADR for the sandbox.

**Why this one.** It is the only option that reaches all three drivers and the
measured weight (reads, searches and diffs) without running code Ork cannot
contain. It is a small, ordinary tool beside `read_input`, and it stays a
decision that is cheap to undo: drop one registry line.

### Rejected, and why

- **Option 1 (pass-through)** is not rejected as an idea but cannot be done:
  `-p` does not support Code Mode. It also covers one driver of three, and moves
  tool calls out of the events Ork's permission, heavy-slot and pause hooks act
  at. Revisit when Claude Code supports it in `-p`; this RFC is not a reason to
  build it first.
- **Option 3 (coordination as code)** is rejected for the weight it reaches:
  about 2% for the leader, under 1% for Ork's tools. Its safety is real, but a
  safe change that moves 2% is not the one to make first.
- **Variant 2b (JavaScript program)** is rejected for now: it needs a sandbox
  Ork does not have, a likely new dependency, and a security review, for a
  ceiling the data does not yet show is needed. The 53% of weight in whole-file
  reads and the 14% in searches are covered by ranges, searches and cuts.
- **Caching rereads of a file already read** was considered from the same
  measurement and dropped: rereads are 24% of reads but 3% of the carried read
  weight.

## Consequences

- **Positive:** a way to read less into every transcript on all three drivers; a
  measurable adoption figure; no new dependency; no code of the model's runs.
- **Negative:** one more tool in each session's catalog (its description is
  carried too, so it stays short); the saving depends on the model using it over
  the shell, which this RFC does not control; reading through it is another step
  beside `Read`, so the same file may be read two ways.
- **To update when it ships:** a spec for the tool in `specs/runtime/` and
  [which-driver](../../specs/runtime/which-driver.md) if a driver gets it
  differently;
  [what-a-session-loads](../../specs/runtime/what-a-session-loads.md); the brief
  and context text that steers sessions to it; user docs and
  [Next release](../../docs/whats-new/next-release.md); the interaction map; an
  ADR (and `pnpm rfc:close RFC-023`); a changeset; and a line in
  [specs/gaps.md](../../specs/gaps.md) for the step language's limits.
- **Work it needs:** give `ToolContext` the session's folder; a containment
  helper that the tool and its tests share.

### What to measure to confirm the pick

A before/after benchmark of the same work, on the same base commit, using
[`pnpm benchmark`](../../benchmarks/README.md) for cost and the same carried
weight script as the 88-session measurement above (see Open questions for where
it lives).

| Measure                                                                       | Why                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Carried weight of reads, searches and diffs (characters x later turns)        | The proxy this RFC rests on; it must fall, by role (implement, review) |
| Cache-read tokens and cost per run, from `ork usage`                          | What the proxy stands for                                              |
| Turns per worker session (the baseline is mean 97, median 66)                 | A tool call costs a turn; turns must not rise enough to cancel the cut |
| Adoption: calls to the tool against `cat`, `sed`, `rg`, `grep` and Read calls | Whether the model chose it, which decides if steering is enough        |
| Returned size against the size the same read would have been                  | The saving per call                                                    |
| Outcome: checks pass, findings the review sends back, run status              | The saving must not come from worse work                               |

The run is the same task set, with the tool off (before) and on (after), several
times each, since sessions vary. The result goes in a published benchmark.

**Read the result as:** if adoption is low, change the steering (context text, a
rule against whole-file `cat`) before changing the tool; if adoption is high and
carried weight does not fall, the step language is the limit and variant 2b gets
its own RFC; if turns rise and cost does not fall, switch the tool off and
record why in the gaps.

## Open questions

- **Where does the carried-weight script live?** The measurement of the 88
  sessions was given in the brief; this RFC did not find it in the repository.
  The benchmark needs it, so either it is added (with the benchmark tooling) or
  the proxy is redone another way.
- **How many runs make a before/after result?** Sessions vary and this RFC does
  not know the variance; the maintainer sets how many runs are enough, and what
  fall in carried weight or cost, with no loss in outcome, counts as a pass.
- **How is the model steered to the tool?** Options are the session's system
  append, the context file of an implement or review node, and a permission rule
  that sends a whole-file `cat` to the tool. Only the first two are cheap; the
  third changes what a driver's rules mean. Not decided here.
- **What does each driver say about a file it would refuse?** The tool must
  refuse what the driver's rules would. For `claude-code` those rules are in
  settings Ork does not read; this RFC did not establish how to ask them for a
  path, or whether the tool should keep its own deny list (such as `.env`
  files).
- **Does it reach `open-code` and `command-code`?** Both reach Ork's MCP tools
  (`questions: true`), but `command-code` runs one session per checkout and has
  no per-node MCP servers; that Ork's tools are served the same way was not
  re-checked for a new tool.
- **Should a review node, which only reads, get the tool preapproved?** It is
  read-only, but a rule set can still say no; whether it needs no prompt on
  `claude-code` is left to the plan.
- **The step language's exact set** (the caps, whether a step may be a regular
  expression with look-around, the size of a `git` output) is for the plan, not
  this RFC.
