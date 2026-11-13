# Known gaps and limits

Status: **Open**: reviewed on 2026-11-07, at the end of M2
([roadmap](../docs/interaction-map/public/js/data/roadmap.js), item
`gaps-review`). What is here waits for the next review.

What Ork leaves out or does a simpler way for now, and has not settled, in one
place, so none of it is forgotten. Specs, ADRs and guides still describe each
where it applies; this register is the list to decide from.

- A **gap** is something specified or expected that is not built, and is not on
  the roadmap.
- A **limit** is how something built works for now, by choice.
- A **chore** is upkeep on the repository rather than on Ork.

Add an entry in the change that finds it, and remove it in the change that
closes it. Ids are never reused: the next limit is L363, and the next chore is
C16 (`pnpm docs:check` fails on an id defined twice, as two changes made at once
can each take the next one). At a review, each open entry is closed (built or
fixed, then removed), kept (moved into its area's spec, then removed here), or
carried to a roadmap item, or to none yet (unplanned).

**Kept limits live with their area's spec,** each in a "Limits" chunk under its
id: [running, resuming and stopping](./scheduler/limits.md),
[workflows calling workflows](./scheduler/calls-limits.md),
[watching a source](./scheduler/watching-limits.md),
[walking a workflow](./scheduler/walking-limits.md),
[messaging, claims and links](./messaging/limits.md),
[scripts](./messaging/scripts-limits.md),
[projects, git and installs](./projects/limits.md),
[usage and quotas](./usage/limits.md),
[the usage ledger and pruning](./usage/ledger-limits.md),
[the browser view](./ui/limits.md),
[the workflow builder](./ui/builder-limits.md),
[design tokens](./ui/design-tokens-limits.md),
[the context inspector](./ui/panels-context-limits.md),
[the feedback loop](./feedback/limits.md),
[Ork for Claude Code](./claude-code/limits.md),
[the Worktrees panel](./worktrees/limits.md),
[upgrading from the browser view](./cli/upgrade-limits.md), and
[the drivers](./runtime.md#limits). A carried limit's words stay there too.

## Contents

- [Limits found building readable gates](./gaps/readable-gates-limits.md)
- [Limits found building for each](./gaps/for-each-limits.md)
- [Limits found fixing QA run e4894f17](./gaps/qa-e4894f17-limits.md)
- [Limits found building end kinds](./gaps/end-kinds-limits.md)
- [Limits found building the machine rules](./gaps/machine-limits.md)
- [Limits found building check once](./gaps/check-once-limits.md)
- [Limits found building the `agent.*` types](./gaps/agent-types-limits.md)
- [Limits found building budgets in tokens](./gaps/budget-tokens-limits.md)
- [Limits found building the conflict resolver](./gaps/conflict-resolver-limits.md)
- [Limits found building the `issues` workflow](./gaps/issues-limits.md)
- [Limits found building follow-ups](./gaps/follow-ups-limits.md)
- [Limits found closing the blind spots of QA run c9c908b9](./gaps/qa-c9c908b9-limits.md)
- [Limits found building the `audit` workflow](./gaps/audit-limits.md)

## Gaps

G1–G7 were built on 2026-11-02, G8–G10 on 2026-11-07, and G19 on 2026-11-08.
Found writing Ork's own workflows (`.ork/`, 2026-11-08), to decide at the next
review:

- **G11 · `ork validate` walks only the inputs' defaults.** It has no `--input`,
  and says nothing about the branches other values would take.
- **G12 · A wrongly typed input default names no type.** It reports
  `Invalid input (schema.invalid_union)` instead of what the input expects.
- **G13 · A gitignored plan is invisible in a worktree.** A node in its own
  worktree sees only committed files and `.worktreeinclude`; passing a plan
  through a program's output is cut at 64 KiB. `start` refuses a file over
  60,000 bytes for that reason, and a plan also travels as one environment value
  and one `--input` argument, which Linux limits to 128 KiB each.
- **G14 · A session's permissions are broad.** Sessions run in Claude Code's
  default mode; a bare `Edit` or `Write` allow isn't held to the node's
  worktree, and a deny rule matches by prefix, so `HOME=… ork …` and
  `git -c … commit` get past it. The project denies the `git -c * commit *` and
  `git -C * commit *` forms since the QA kit change; other prefixes still get
  past.
- **G15 · A session server's program isn't checked before the run.** A node gets
  a browser by naming it (`mcp:`,
  [ADR-067](../decisions/ADR-067-nodes-name-mcp-servers.md)), but the pre-flight
  "program not installed" check (`mcpProblems`) covers `mcp.call` servers only,
  so a missing `npx` shows when the session starts, as Claude reports it.
- **G16 · `ork context explain` shows only the system prompt.** Not the brief's
  size, nor the node's model, budget or permissions.
- **G17 · A project can't set `verify:` as a default.** Project defaults take a
  `before:` step only, so a gate such as `pnpm check` repeats on each node.
- **G18 · No command writes a workflow in canonical form.** The serializer is
  only reachable from the schema package, so a hand-written file can't be
  normalized from the CLI.
- **G20 · The walk calls a loop "out of rounds" after two.** It stops walking a
  loop after two rounds whatever its `maxRounds`, and labels the path as if the
  rounds ran out.
- **G21 · Ork doesn't check a report field written as JSON Schema.** A list of
  objects such as `build`'s `decisions` is required in the report's schema, but
  only the driver's structured output enforces it: Ork's own declared-output
  check skips such a field.
- **G22 · Some answers' notes are only recorded.** A
  [note](./messaging.md#decisions) given to a loop out of rounds or a link at
  its limit is stored and shown, but reaches no session: "one more round" can't
  say what to change in it.
- **G23 · Runs that ended `succeeded` by mistake stay that way.** Before
  [rounds](./scheduler.md#activations), a join waiting on a branch a loop didn't
  go back to could end a run `succeeded` without its gate. Those runs are
  recorded as `succeeded`, so `ork resume` refuses them; run them again.
- **G24 · An older run looks for its driver again when resumed.** A run started
  before [the driver rule](./runtime.md#which-driver-a-session-uses) recorded no
  `readyDriver`, so `ork resume` takes the one ready now.
- **G25 · A leader's fork is unproven on a real session.** A child's question to
  its leader ([leader questions](./messaging/leader-questions.md)) is answered
  by a fork of the leader's session, tested only against stand-ins. The first
  real run must measure: (1) while the leader waits in `delegate`, its saved
  session ends with that pending call; whether `--fork-session` resumes it
  cleanly; (2) what a fork reports as `total_cost_usd`: a resumed session
  reports its total so far, carried over from its transcript (ADR-046), and a
  fork copies that transcript, so it may report the leader's total plus its own;
  Ork counts the fork's whole report (as `<leader>/<fork session>`), which would
  overcount the run's spend and might trip the fork's `--max-budget-usd` at
  once; if it does, charge the report less the leader's last total; (3) the
  fork's tools and system prompt differ from the leader's, so each question
  reads the leader's session uncached; (4) that the structured report still
  comes back with `--tools Read,Grep,Glob`.
- **G27 · A permission is answered one call at a time.** Each Bash command asks
  again (six in run 0427fb01); nothing allows a tool for the rest of a node.
- **G28 · An experiment has no way out.** Nothing promotes or removes one.
- **G29 · A node can't refuse what its rules don't allow.** A tool call outside
  a node's allow rules always stops the run to ask the maintainer, even on a
  read-only node such as a reviewer, and Claude Code asks about some commands (a
  heredoc script, a loop, `cd` then `git`) even when `Bash` is allowed. Run
  `5546557f` (2026-11-12) waited five times, once for 58 minutes, on commands
  its prompts had ruled out. A node setting that refuses such a call with a
  message, so the session retries with an allowed command, would close it.
- **G30 · A session at its turn limit hands in nothing.** A worker that reaches
  `maxTurns` ends `turn_limit` with no report, and its round fails, though its
  work is in its checkout. With `session: resume`, the owner sends it back and
  the resumed session re-reads everything to hand in a report: engine's round 3
  in run `c93e5bd3` (2026-11-12) took 3 turns to do that. Each of the last three
  builds hit the limit once or twice. At the limit, Ork could resume the session
  once, briefly, asking only for its report (what is done, what is not), and end
  the round with that.
- **G31 · A tool error is filed without its reason.** When a call to one of
  Ork's tools fails, Ork files `ork/bug` feedback at medium severity, saying
  "the node's events show the call". The event keeps only `isError`, not the
  error text, so nobody can tell an Ork failure from an input Ork refused. Two
  items on 2026-11-12 were refusals of the model's own input: `child` passed to
  `spawn_worker`, and a `report` with a field of the wrong type. Keeping the
  refusal's text (scrubbed) in the evidence, and filing a refused input against
  the workflow rather than against Ork, would close it.

## Limits

Carried at the 2026-11-07 review. Each links to its words in its area's spec.

| Id   | Limit                                                                                         | Carried to  |
| ---- | --------------------------------------------------------------------------------------------- | ----------- |
| L17  | [A `tool.git` commit under `commit: never` is on no branch](./projects/limits.md)             | unplanned   |
| L26  | [The UI cannot talk to a finished run's node yet](./ui/limits.md)                             | unplanned   |
| L36  | [A browser limits the streams of all a server's tabs together](./ui/limits.md)                | unplanned   |
| L37  | [The Runs panel sees the newest 50 runs](./ui/limits.md)                                      | unplanned   |
| L40  | [Claims are per run](./messaging/limits.md)                                                   | unplanned   |
| L41  | [A retry has no delay](./scheduler/limits.md)                                                 | unplanned   |
| L48  | [A link does not survive a resume](./messaging/limits.md)                                     | unplanned   |
| L50  | [The UI can only look at links](./messaging/limits.md)                                        | unplanned   |
| L51  | [A link's limit of 100 is a guess](./messaging/limits.md)                                     | `benchmark` |
| L52  | [A link ending can cost a session a turn](./messaging/limits.md)                              | `benchmark` |
| L57  | [A message to a call that never starts is lost](./scheduler/calls-limits.md)                  | unplanned   |
| L61  | [Parallel activations of one id come back by position](./scheduler/calls-limits.md)           | unplanned   |
| L65  | [Logs filters only what is loaded](./ui/limits.md)                                            | unplanned   |
| L67  | [A thread shows what is loaded](./ui/limits.md)                                               | unplanned   |
| L89  | [`ork send`'s cap and size are first guesses](./messaging/scripts-limits.md)                  | `benchmark` |
| L93  | [A `before:` default can't be turned off for one node](./messaging/scripts-limits.md)         | unplanned   |
| L107 | [The builder won't add a second edge between the same two nodes](./ui/builder-limits.md)      | unplanned   |
| L108 | [Two tabs on one workflow can overwrite each other](./ui/builder-limits.md)                   | unplanned   |
| L112 | [A declared output is one level deep](./ui/builder-limits.md)                                 | unplanned   |
| L114 | [A pass-through with several inputs offers no choices](./ui/builder-limits.md)                | unplanned   |
| L116 | [The floors on `every` aren't measured](./scheduler/watching-limits.md)                       | unplanned   |
| L129 | [The launchd and systemd files in the guide haven't been run](./scheduler/watching-limits.md) | unplanned   |
| L134 | [There's no check that nothing moved](./ui/design-tokens-limits.md)                           | unplanned   |
| L136 | [Now and node times are only in the browser view](./ui/design-tokens-limits.md)               | unplanned   |
| L141 | [A very wide workflow overruns a walk's time](./scheduler/walking-limits.md)                  | unplanned   |
| L145 | [The plugin follows `main`, not a release](./claude-code/limits.md)                           | unplanned   |
| L149 | [An item's status follows the `apply` that started its run](./feedback/limits.md)             | unplanned   |
| L153 | [Merging items is only in the CLI](./feedback/limits.md)                                      | unplanned   |
| L154 | [The Feedback panel follows the runs, not the feedback](./feedback/limits.md)                 | unplanned   |
| L157 | [One write per project is held only within `ork ui`](./worktrees/limits.md)                   | unplanned   |
| L171 | [A Claude report's fields are not cut](./runtime.md#limits): a size threshold                 | `benchmark` |

L116 waits for first real use, and L129 for a hand check across a restart.

Found building [tab completion](./cli/completion.md) (2026-11-08), to decide at
the next review:

- **L176 · Completion takes `--flag value`, not `--flag=value`.** A value
  written after `=` is read when it comes before the cursor, but not completed
  under it.
- **L177 · Only some values complete.** Feedback item ids, project ids
  (`ork projects forget|move`), agent names, `ork link`'s tools and
  `ork relay`'s `<run>/<node>` get none, and only the first of several files to
  `ork validate` gets workflow names.
- **L178 · The bash script is plain.** bash shows no descriptions, and the
  script splits the line at spaces itself, so a quoted word with a space in it
  is split.
- **L179 · The fish script hasn't been run in fish.** zsh and bash (3.2, in a
  test) were run; fish was not installed where it was built. Checked against
  fish's changelog instead: `$tokens[2..-1]` on a one-token line is empty since
  fish 3.0 (a range clamps without changing direction), and fish 4.0 deprecates
  `commandline -o` for `-x`, which fish 3 lacks, so the script tries
  `commandline -xpc` and falls back to `-opc`.

Found building [clean sessions](./runtime/what-a-session-loads.md) (ADR-065):

- **L180 · Only strict MCP is measured.** The $0.113 to $0.032 probe (CLI
  driver) measured `--strict-mcp-config`; the other two switches are unmeasured
  until the rerun.

- **L213 · A `continue` node can't follow a tool node.** Its worktree is found
  through gates and control nodes only, so a program can't decide whether a gate
  before it opens. `build`'s `ratify` gate therefore runs on every build
  ([ADR-071](../decisions/ADR-071-workflows-by-stage.md)).

Found removing the Agent SDK driver
([RFC-014](../rfcs/archived/RFC-014-cli-drivers-only.md)):

- **L234 · No mid-session permission prompts off `claude-code`.** A driver
  without `permissionPrompt` gets the node's allow and deny lists as its tool's
  own rules, deny by default, so what `claude` would have asked about is refused
  instead. Driver fit also checks only what a workflow states: a message over a
  link made at run time is not checked against the node's driver, and a worker's
  own `ask_user` is not either, only a leader that delegates.

- **L235 · Command Code runs one session per checkout.** Its MCP entry is per
  folder, so a second session in a checkout waits for the first, logged as a
  `session.waiting` event; `ork validate` warns where siblings could queue, and
  refuses an owner with a node it owns in its checkout (they would deadlock).
  `cmd acp` is the later fix. Also: permissions are enforced by an Ork-written
  `--mod`, with Command Code's own gate off (`--dangerously-skip-permissions`),
  so a broken mod would leave nothing in its place; the machine's skills,
  memory, mods and MCP servers still load; a node's own `mcp` servers are not
  wired, so such a node is refused (`mcpServers: false`); plan mode is not
  mapped; no hold hook on pause; exit 8 without a result line falls to a generic
  failure; stale leases are swept at a Command Code session's start and by
  `ork doctor`, not at run start; two paths can share one slug; the stale sweep
  is not atomic across two processes; a corrupt lease record is dropped as
  stale, but the `ork` entry it may have left is then found by the next
  session's check and refused, not removed.
- **L236 · OpenCode limits.** No hold on pause mid-session; `glob` and `grep`
  are not allowed by default; an empty `XDG_CONFIG_HOME` hides `~/.config/git`
  from shell commands; `--model` needs `provider/model` (RFC-015); `effort` is
  not mapped and `machineClaude` does not apply; the secret config lives under
  the temp folder, not the run folder; a crashed session's folder is swept at
  the next `open-code` session only, not by `ork doctor`; the brief is visible
  as a process argument.
- **L237 · The `report` tool reads a schema with zod.** A report schema zod
  cannot read falls back to any object plus the status and summary check.
- **L238 · No protocol drivers.** OpenCode's server and ACP (`cmd acp`) stay a
  later change to a single adapter.
- **L240 · Claude through OpenCode's `commandcode` provider fails.** After any
  tool call the next request is refused ("assistant message prefill", or a
  `thinking` block's signature), on Haiku and Sonnet 5.5 alike; other models
  through the same provider work. It lies between OpenCode and the provider, so
  the guide says to run Claude on `claude-code`. A node that hits it now ends as
  [Model unavailable](../docs/guides/why-a-node-stopped.md#model-unavailable)
  with the provider's text under Details, not as raw JSON in the run summary.

- **L249 · The terminal kit counts a code point as one column.** A wide
  character (CJK, an emoji) can make a line one column too long, which wraps it.
  Width by `Intl.Segmenter` and an East Asian width table waits for a report.
  See [terminal](./cli/terminal.md#limits).
- **L250 · A select taller than the screen is not scrolled.** A list of more
  options than the terminal has rows redraws wrongly; the details are cut to
  fit, the options are not.
- **L251 · A killed process can leave the cursor hidden.** A prompt restores the
  cursor and raw mode on every exit it can see (an answer, Esc, Ctrl-C, a
  withdrawal), not on `SIGKILL` or `SIGTERM`; `reset` or the next prompt shows
  it again.
- **L252 · Only tool lines are cut to the screen width.** Other run events (a
  message's first line, a claim, a failed node's detail, a warning) are not cut
  or wrapped by the kit; the terminal wraps them.
- **L253 · A live `ork chat` asks line by line.** Replies print while it waits,
  which a redrawn prompt cannot share the screen with, so the prompt is the
  plain one (no in-place editing or cursor keys beyond the terminal's own).
- **L254 · Plain output has not been checked with a screen reader.** The plan
  calls for a VoiceOver pass over `--plain`; it is not done.
- **L255 · `--plain` is taken out of the arguments wherever it appears.** A
  `--plain` that is another flag's value (`ork chat -m --plain`) is dropped
  before the command sees it, and sets plain output. Put the value after `=` or
  after `--` to send it as text; reading each command's flags to tell the two
  apart waits for a report.

Found building [`ork attach`](./cli.md) (2026-11-10), to decide at the next
review:

- **L324 · A foreground `ork resume` does not show or ask its called runs.** A
  resumed caller adopts the runs it had called, and an adopted call emits no new
  `call.started`, so nothing starts following it; its questions wait in
  `ork decide` or the UI, and `ork attach <run>` shows the whole tree
  ([calls](./scheduler/calls.md)).

Found resuming build run `cc7c1c29` (2026-11-12), to decide at the next review:

- **L272 · A message queued for a node that won't run again waits silently.**
  `ork chat` to a node between sessions queues the message "for its next
  session"; if the run goes on without running that node again, nothing says the
  message was never read, and a later `ork resume` runs the node again to
  deliver it ([messaging](./messaging.md)). Telling the sender (and the run's
  summary) when a queued message's node has finished for good would close it.

- **L332 · `--driver` checks a driver no node will use.**
  `ork run --driver <id>` runs that driver's readiness check and refuses when it
  isn't ready, even when no agent node of the run would use it, as in a workflow
  of tool nodes only
  ([ready-driver.ts](../packages/cli/src/run/ready-driver.ts)). Scoping the
  check to the drivers the run's agent nodes use would close it.

Found closing nine follow-ups (2026-11-13), to decide at the next review:

- **L333 · A session re-entered across activations has a first-turn cost
  baseline problem.** Its first turn in the new activation passes
  `priorCostUsd = 0` to `limitWatch`, but claude-code reports the session's
  cumulative cost ([ADR-046](../decisions/ADR-046-usage-ledger-and-prune.md)),
  so that first turn can still blame the run's dollar budget when the node's
  token cap stopped it (`ownSpend`). On a driver that reports each process's own
  cost (open-code), a resumed turn whose own cost is at least the prior total is
  under-counted, so a turn that did reach the run's dollar cap may not stop the
  run as `budget_exhausted` ([budget](./scheduler.md#budget-and-concurrency)).
- **L334 · The issues example undercounts taken issues past 100.** The
  all-in-progress message counts taken issues with `--limit 100`, so it
  undercounts past 100 labelled issues
  ([guide](../docs/guides/issues-in-parallel.md)).
- **L335 · The `ork stop` end-to-end test checks tokens and status only.**
  Dollars are 0 in that fixture, as the fake spend has no cost, so the ledger
  row, `ork ps` and `ork usage` are not compared on dollars.
- **L336 · A delegated child's `description` shows only in `ork tree`,
  `ork logs` and the Logs and Monitor panels.** It is not shown in chats, usage,
  notifications or graph cards, by design
  ([delegation](./scheduler.md#delegation)); showing it there would be a new
  change.

Found building the list filters ([list filters](./cli/list-filters.md),
RFC-017):

- **L337 · A list can't take a condition.** Each list filters by its table's
  fields, equal or since/until; there is no generic `--where` and no `!=`, `>`
  or `~`. RFC-017 weighed it and left it for when a field table is not enough. A
  `--where` over the same tables would add it with no new flag per field.
- **L338 · Filters apply after the store read.** A list reads its rows, then
  keeps the ones a filter matches, then cuts to `--limit`. Nothing has measured
  a store large enough for that to be slow. Passing a filter into the store's
  query would close it.
- **L341 · `ps --ids` is limited to 20 by default.** `ork ps` shows 20 runs
  unless `--limit` says more, `--ids` included, so a script that wants every id
  passes a larger `--limit`. A default that only a terminal list has would close
  it.

Found building the list filters in the server and the UI (L339, closed):

- **L350 · The list routes read an unregistered `project` as a root.** `runs`,
  `usage`, `decisions` and `worktrees` take `project` as a registered project's
  id or root and, as before, any other value as a root; a plan to read only
  registered projects would refuse it (400) and could break callers that pass a
  root Ork no longer registers. The `ork mcp` tools already refuse an
  unregistered `project`; only these HTTP routes still read it as a root.
  `follow-ups` is named by its path, and a different `project` query lists
  nothing.
- **L351 · Clean merged… ignores the `run` filter.** The Worktrees panel's Clean
  merged… plans for the project the filter keeps, or every project, never for
  one run's worktrees, so the button can clean merged worktrees the list does
  not show.
- **L352 · A bar field may say a default the panel does not have.** The
  Worktrees panel lists every project, but the `project` field's help line, the
  table's, still says "default: the one you are in" (the CLI's). The filter bar
  shows the table's words unchanged.

Found closing the list QA follow-ups (list filters):

- **L359 · Only the list commands refuse an unknown flag.** `refuseUnknownFlags`
  is on the nine list leaf commands. Every other command (`run`, `stop`, `once`,
  `ork worktrees` with no subcommand and its `wt` alias, …) still reads an
  unknown flag as nothing, because citty's parser is not strict and a parent
  command would see its subcommands' flags as unknown. Closing it needs a check
  per command, with `ork once --` and `ork run`'s inputs left out.
- **L360 · The feedback and worktrees routes take a full run id.**
  `GET /api/feedback` and `GET /api/worktrees` read `run` as an exact id, while
  `ork feedback list --run` and `ork worktrees list --run` take a unique start
  of one and refuse an unknown run. The browser's `run` field takes a full id
  (the suggestions give it). A prefix check in the shared routes would close it,
  with L350.
- **L361 · `feedback list --run` and `worktrees list --run` refuse the full id
  of a pruned run.** `resolveRun` follows `findRun`, so an id whose run is gone
  from the store reads as an unknown run, even in full. Reading a pruned run's
  rows would need the lookup to fall back to the exact id.
- **L362 · `ork projects --bogus` prints help before the message.** `projects`
  has subcommands, so citty shows its help and then the unknown-flag line,
  unlike the other list commands, which print one line. Closing it needs the
  check to run before citty's help (see L359).

## Chores

- **C2 · Release pull requests run no CI.** Pull requests opened with the
  built-in `GITHUB_TOKEN` trigger no workflows; CI's release job, which needs
  every CI gate, still gates publishing. Kept on 2026-11-07 as a deliberate
  limit, since every other change goes straight to `main`. Open only until these
  words move into the [release runbook](../runbook/development/release.md).
- **C8 · The repository sets `skipLibCheck`.** dockview's declarations and the
  MCP SDK's HTTP client don't pass under `exactOptionalPropertyTypes`, so
  `packages/ui` and the root config don't check any library's declarations, and
  [mcp-sdk.d.ts](../packages/nodes/src/mcp-sdk.d.ts) retypes that client. Remove
  both when those libraries fix them. Carried, unplanned: try again at each bump
  of either.
  ([workspace](./ui/workspace-layout-and-narrow-window.md#the-saved-layout))
- **C9 · An age exclusion waits to be removed.** `pnpm-workspace.yaml` exempts
  containerized-state 3.4.0, its React package 3.4.0 and its persistence plugin
  1.4.0 from the 7-day rule, by exact version, at their author's choice. Remove
  the list from 2026-11-10; the versions then satisfy the rule.
- **C11 · A session a plan refuses has not been seen.** Claude Code's types
  describe `rate_limit_event` and a `rate_limit` error, and one real session
  showed the event with `status: allowed`, but a refusal can't be provoked on
  purpose. Ork acts on the documented `rejected`, tested against stand-ins.
  Check it against the first real refusal: that the event comes, that the
  session ends, and that `ork resume` goes on. Carried, unplanned: it waits on
  the world. ([usage](./usage.md#limits-across-runs))
  ([ADR-002](../decisions/ADR-002-typescript-from-source.md))
- **C12 · A fan-out hasn't run on a real driver.** One run on the `claude` CLI
  driver of a `from:` fan-out of Claude workers into worktrees (paid) is left to
  the maintainer, after the second run has landed. Check that items start
  together under `maxParallel`, that each takes its own session and worktree,
  and that a resumed run goes on with the unfinished ones. Carried, unplanned:
  it waits on the world.
  ([running a node once per item](./scheduler/for-each.md))

- **C13 · No `fix` workflow.** A bug has to go through `plan`'s gate. A shorter
  path would reproduce it, write a failing test, fix it and review it.
- **C15 · The `audit` workflow hasn't run on a real driver.** The first `quick`
  audit of Ork (`ork run audit`, at most $29) is paid and left to the
  maintainer. Check that the read-only agents never stop to ask permission for a
  command they are meant to run, that each node stays inside its budget (a
  hunter that runs out of its $2 fails and loses its work), that the
  `{ list: {} }` outputs come back in the shapes the shell steps read, and that
  the report is written under `~/.ork/audits` with `git status` clean. Carried,
  unplanned: it waits on the maintainer's go.
  ([the runbook](../runbook/development/security-audit.md))
