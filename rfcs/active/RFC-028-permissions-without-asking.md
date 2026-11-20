# RFC-028 — Permissions without asking: parse, refuse, remember, suggest

- **Status:** Accepted
- **Date:** 2026-11-20
- **Supersedes:** —
- **Superseded by:** —

## Contents

- [Context](#context)
- [Options](#options)
- [Decision](#decision)
- [Consequences](#consequences)
- [Open questions](#open-questions)

## Context

A Claude Code session asks Ork's own `permission` tool whether to run a call
that Claude Code's rules neither allow nor deny
([permission.ts](../../packages/runtime/src/tools/permission.ts), named by
`--permission-prompt-tool` in
[claude-code.ts](../../packages/runtime/src/adapters/claude-code.ts)). The tool
forwards every such call to `ports.human.permit`, which opens a `permission`
decision (`Allow <tool>?`, options `allow` and `deny`,
[permission-prompt.ts](../../packages/core/src/control/permission-prompt.ts)).
The tool never looks at the call or the node's rules, so Ork answers nothing
itself.

**The evidence.** On 2026-11-20 the read-only `spec` node of plan run `92029b1e`
(inside start run `88c3f7b5`) asked `Allow Bash?` seven times, and the
maintainer allowed every one. All seven were reads:
`pnpm -s ork logs <run> --json | jq …`, `for r in …; do …; done` loops over
`ork logs`, `( … | head ); ls ~/.ork/projects`, `timeout 60 …` and `git log`.
Two causes:

1. `ork logs` and `jq` are on no allow list
   ([.ork/project.yaml](../../.ork/project.yaml) allows `wc`, `cut`, `sort`,
   `ls` and others, but not these).
2. Claude Code asks about loops, subshells and wrappers even when every command
   inside is allowed.

Two gaps in [specs/gaps.md](../../specs/gaps.md) record the same cost: **G27**
(a permission is answered one call at a time; six prompts in run `0427fb01`) and
**G29** (a node cannot refuse what its rules do not allow; run `5546557f` waited
five times, once for 58 minutes).

**What exists.** Ork already reads shell lines in two places, and neither is
used by the `permission` tool:

- `shellParts` in
  [tool-rules-source.ts](../../packages/runtime/src/tools/tool-rules-source.ts)
  splits a line at `;`, `&`, `|`, `&&`, `||` and line ends outside quotes. It
  returns nothing (so only a plain `Bash` rule covers the line) for a command or
  process substitution, an unclosed quote, and a redirect to anything but
  `/dev/null` or another stream. A line is allowed only when every command is
  covered by a rule, and denied when any command matches (or may match) a deny
  rule. The Codex, Command Code and omp guards embed it. It does not read
  `( … )`, `for`, `while`, `timeout`, `env` or `cd`: `( cmd` and `do cmd` are
  taken as commands no rule matches.
- `shellReadReason` in
  [shell-reads.ts](../../packages/runtime/src/tools/shell-reads.ts) finds
  pipelines that start by reading files and refuses them with the `extract` call
  to make (RFC-025). It runs in the `PreToolUse` hook
  ([heavy-hook.ts](../../packages/runtime/src/heavy-hook.ts)).

`readOnlyCommands` in [tool-rules.ts](../../packages/core/src/run/tool-rules.ts)
allows `git status` on a read-only node (and `diff`, `log`, `show` under
`reading: open`); any other command asks, and its comment says so on purpose: "a
reviewer can run the tests with leave".

**By driver.** Only `claude-code` has `permissionPrompt`
([drivers.ts](../../packages/integrations/src/drivers.ts)). Codex, OpenCode,
Command Code and omp already get the node's lists as deny-by-default rules, so a
call outside them is refused, not asked (L234). Parts 2 and 3 therefore change
`claude-code` only; part 1's parser is shared, so a better parser also lets the
other drivers run a loop their rules cover.

**Related limits.** G14: a deny rule matches by prefix, so `HOME=… ork …` gets
past it. A parser that reads `env` and `cd` wrappers closes that on the lines it
reads, but not in Claude Code's own matching of the lines it allows by itself.

## Options

The brief asks for four parts. Each has its own alternatives.

### Part 1 — Parse the line

#### 1A — One shared parser and a shipped read-only set, in the harness

Extend `shellParts` into a small reader of the shell forms a session writes
(`( … )`, `for … in … ; do … ; done`, `while`/`until`, `if`, and the wrappers
`timeout`, `env`, `cd`, `time`, `nice`), and call it from the `permission` tool.
A line is allowed without asking when every simple command it contains is
covered by the node's allow rules or by a built-in read-only set Ork ships. Deny
rules are checked against every simple command, wrappers peeled off. A line the
reader cannot take apart with certainty (a redirect to a file, command
substitution, `eval`, a heredoc, a function, `case`, a variable or glob in the
program's place, an unknown wrapper such as `xargs`, `sudo` or `sh -c`) still
asks.

The shipped set lists a program and, where it matters, its subcommand and the
flags it may not carry: Ork's own reads (`ork logs`, `ps`, `tree`, `usage`,
`feedback list|show`, `follow-ups list|show`, also as `pnpm ork` and
`pnpm -s ork`), `jq`, `wc`, and similar filters. A program that can write or run
another program is in only without that form: `sort -o`, `uniq` with an output
file, `sed -i`, `find -exec`, `awk`, `tee`, `xargs`, `ork decide`.

- **Pros:** deterministic and the same on every project; closes the seven
  prompts of the evidence run; the parser is the one the other drivers' guards
  already use, so the readers stop drifting; adds no model call.
- **Cons:** the largest security surface of the four parts. Every form the
  reader takes in is a form it can mis-take. The set is a list Ork must keep
  true when a command gains a flag.

#### 1B — Project rules only

Add `Bash(ork logs *)`, `Bash(jq *)` and the other reads to this repository's
[.ork/project.yaml](../../.ork/project.yaml), and extend the reader only to
split loops and subshells.

- **Pros:** the smallest change; the maintainer reviews every command in a diff.
- **Cons:** helps this repository only; every other project meets the same
  prompts; `ork logs` is not a project command but Ork's own, so each project
  would have to rediscover it.

#### 1C — The shipped set for read-only nodes only

As 1A, but the built-in set applies only to `readonly` nodes, as git reads do
now.

- **Pros:** a writing node's allowances stay exactly what its author wrote.
- **Cons:** the evidence's prompts came from a read-only node, but a `build`
  node reading `ork logs` asks just as often; the set would be a second list to
  explain.

### Part 2 — Remember answers

#### 2A — Offer scopes; "always" writes the project's `permissions.allow`

The prompt offers Allow once, for this node, for this run, always. The first
three are kept in the run's state (recorded with the decision answer, so a
resume rebuilds them) and write no file. "Always" appends a rule to the
project's `.ork/project.yaml` (or `~/.ork/projects/<id>/project.yaml` for a
project attached from outside) after the exact rule is shown, as the option's
description, so the terminal, `ork decide` and the UI show the same text. The
rule is the program and its subcommand with `*` after
(`pnpm -s ork logs r1 --json` becomes `Bash(pnpm -s ork logs *)`); Ork never
generalises past the subcommand, never writes a rule for a line it cannot read,
and writes one rule per simple command of a line.

- **Pros:** uses the rules every node already reads
  ([project rules](../../specs/project-rules.md#precedence)); the rule is a diff
  the maintainer reviews; no new file or precedence.
- **Cons:** a contributor's "always" widens what every contributor's nodes may
  run once it is committed; editing `project.yaml` must keep its comments
  ([edit-lines.ts](../../packages/schema/src/edit-lines.ts) edits YAML in place;
  whether it fits is an open question); four prompt front ends change (terminal,
  `ork decide`, UI, MCP).

#### 2B — "Always" writes the user's own rules

A per-user file outside the repository, merged under the project's.

- **Pros:** nothing a person allowed lands in a committed file.
- **Cons:** a new file, a new schema and a new precedence rule, for a surface
  the specs do not have today; the rules are invisible to a teammate reading why
  a node may run a command.

#### 2C — Ask which at the prompt

A second question after "always": this project, or just me.

- **Pros:** the person decides what is shared.
- **Cons:** both write paths and both rule sets to build and keep true; one more
  question on a prompt the work is meant to shorten.

### Part 3 — Refuse on read-only nodes

#### 3A — Refuse in the `permission` tool, on by default, with an opt-out

When a call reaches the `permission` tool, the node is read-only, and part 1's
reader finds it outside the node's rules, the tool returns `deny` with a
message: what the node may run (its Bash rules, the shipped set in a line) or,
for a read, the `extract` call to make (`shellReadReason`). The session retries
with an allowed command, and nobody waits. A node setting and a workflow `rules`
key turn the refusal back into a prompt.

- **Pros:** the tool is called only for what Claude Code would have asked about,
  so a call that Claude's own settings allow is never refused; reuses part 1's
  reader; closes G29 for the case in the evidence.
- **Cons:** removes the "a reviewer can run the tests with leave" behaviour in
  `readOnlyCommands`: a reviewer needing `pnpm test` must have it in its rules
  or opt out. A session may retry a refused call; the refusal costs a turn.

#### 3B — Refuse in the `PreToolUse` hook

The hook ([heavy-hook.ts](../../packages/runtime/src/heavy-hook.ts)) already
refuses reads with a reason.

- **Pros:** the refusal happens before Claude Code decides.
- **Cons:** the hook runs before Claude Code's own rule check and cannot tell
  which calls Claude would have allowed from its settings sources, so it can
  refuse a call that was allowed. It also runs for every call, not only the ones
  that would have asked.

#### 3C — Opt-in only, or keep a prompt for tests

Off unless a node sets it; or on, but a read-only node's test and build commands
still reach the maintainer.

- **Pros:** no workflow changes behaviour on upgrade.
- **Cons:** the evidence run's node would still wait unless its author found the
  key; G29 stays open for everyone who does not.

### Part 4 — Suggest rules from history

#### 4A — A feedback item from repeated allows

The decision store keeps each answered `permission` decision with its command in
`context`. When a command (generalised as in 2A) was allowed repeatedly across
runs, Ork records a system feedback item proposing the allow rule, in the way
`permission.denied` is derived from the event store
([signals.ts](../../packages/core/src/feedback/signals.ts)): no model call. The
person accepts it through the feedback flow.

- **Pros:** no new capture; goes through the feedback loop that already needs a
  person to accept; a rule proposed from what was allowed, not guessed.
- **Cons:** useful only after parts 1–3 have left enough prompts to count; only
  `claude-code` produces permission decisions, so it sees nothing from the other
  drivers.

#### 4B — A command that lists suggestions

`ork permissions suggest` prints candidate rules on request.

- **Pros:** no feedback item to triage.
- **Cons:** a person has to remember to run it; it adds a command for what the
  feedback loop already carries.

#### 4C — Skip it

Rely on parts 1–3.

- **Pros:** nothing to build or keep true.
- **Cons:** G27 closes only for prompts the shipped set already covers.

## Decision

The maintainer picked all four parts, built in this order:

1. **Part 1 — 1A.** One shared parser and a shipped read-only set, in the
   harness, for every node of every project. A line it cannot read with
   certainty still asks, and deny rules are checked against every simple
   command.
2. **Part 3 — 3A.** A read-only node's call outside its rules is refused with a
   message, on by default, with an opt-out per node and per workflow. The
   refusal sits in the `permission` tool (3A), not the hook (3B): the reasons
   are in Context and Options, and the maintainer can overturn them under Open
   questions.
3. **Part 2 — 2A.** Allow once, for this node, for this run, always. "Always"
   adds a prefix rule (program and subcommand, then `*`) to the project's
   `permissions.allow`, shown before it is written.
4. **Part 4 — 4A.** Repeated allows across runs become a feedback item proposing
   the rule.

**Why this order.** Part 1 needs no new prompt and closes the seven prompts of
the evidence on its own. Part 3 decides "outside the rules" with part 1's
reader, so it follows. Part 2 changes the decision's options in the terminal,
`ork decide`, the UI and the MCP tools, and writes a file, so it is the largest
change to people's habits. Part 4 needs part 2's generalisation to propose a
rule and a history that parts 1–3 leave behind.

**Security rule for all four parts.** A parser that allows too much is worse
than a prompt, so the reader allows only forms it takes apart completely. Each
form it learns (a loop, a subshell, a wrapper) lands with tests that include the
lines it must still refuse; anything else keeps asking.

## Consequences

- **Positive:** most read-only prompts of the evidence disappear without a model
  call; a read-only node stops waiting on a maintainer for a call it cannot
  make; an answer can be kept; repeated answers turn into a proposed rule.
- **Negative:** a read-only node that relied on asking for `pnpm test` is
  refused until its author adds a rule or opts out (an "Upgrade:" line in the
  release note). The shipped set is a list Ork keeps true. "Always" edits a
  committed file.
- **Drivers:** parts 2, 3 and 4 act on `claude-code` only (the other drivers
  have no prompt to answer, so nothing to remember, refuse or count); part 1's
  parser also lets the others run lines their rules cover. L234 stays open.
- **Gaps:** G27 and G29 close when parts 2 and 3 ship; G14 gets a note (the
  reader peels `env` and `cd` on the lines it reads, not in Claude Code's own
  matching); L234 gets a note.
- **Follow-up work:**
  - specs: [project rules](../../specs/project-rules.md) (the shipped set, the
    opt-out, "always"), the terminal prompt in
    [running-and-runs.md](../../specs/cli/running-and-runs.md#questions-and-permissions-on-the-terminal),
    the decision options in [messaging](../../specs/messaging.md), the feedback
    signal in [capture.md](../../specs/feedback/capture.md);
  - user docs and a [next release](../../docs/whats-new/next-release.md) bullet
    for each part;
  - an ADR on archive, and the interaction map's permission card;
  - the two shell readers (`tool-rules-source.ts`, `shell-reads.ts`) share one
    splitter, so the `permission` tool needs no third.

## Open questions

- **A repeated allow (part 4):** how many allows, across how many runs, make a
  proposal? Nothing in the store was measured; pick a threshold when part 4 is
  planned.
- **Retries (part 3):** a session that keeps retrying a refused call spends
  turns. Should a node that is refused the same call a number of times ask the
  maintainer instead? The number is not measured.
- **Where the refusal sits (part 3):** the `permission` tool, as in 3A, or the
  hook (3B)? The tool cannot refuse a call Claude Code allows by itself; the
  hook can. Confirm 3A.
- **The shipped set:** the exact list of programs, subcommands and refused
  flags, including `jq` (`-f`, `--rawfile` and `--slurpfile` read other files)
  and whether a path argument that matches a `Read(…)` deny rule asks.
- **`project.yaml` edits (part 2):** can the "always" write keep the comments of
  a file such as this repository's with `edit-lines.ts`, or does it need another
  way?
- **Other drivers (part 4):** their refused calls are not decisions. Is a
  refused call a signal worth counting later?
