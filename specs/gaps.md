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
closes it. Ids are never reused: the next limit is L182. At a review, each open
entry is closed (built or fixed, then removed), kept (moved into its area's
spec, then removed here), or carried to a roadmap item, or to none yet
(unplanned).

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

## Gaps

G1–G7 were built on 2026-11-02, G8–G10 on 2026-11-07, and G19 on 2026-11-08.
Found writing Ork's own workflows (`.ork/`, 2026-11-08), to decide at the next
review:

- **G11 · `ork validate` walks only the inputs' defaults.** It has no `--input`,
  and says nothing about the branches other values would take.
- **G12 · A wrongly typed input default names no type.** It reports
  `Invalid input (schema.invalid_union)` instead of what the input expects.
- **G13 · A gitignored task spec is invisible in a worktree.** A node in its own
  worktree sees only committed files and `.worktreeinclude`; passing a spec
  through a program's output is cut at 64 KiB.
- **G14 · A session's permissions are broad.** Sessions run in Claude Code's
  default mode; a bare `Edit` or `Write` allow isn't held to the node's
  worktree, and a deny rule matches by prefix, so `HOME=… ork …` gets past it.
- **G15 · A run has no browser.** Ork doesn't load the user's Claude Code
  settings, so a node can't use browser tools: an audit or QA node is held to
  static checks and tests.
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
  objects such as `feature`'s `decisions` is required in the report's schema,
  but only the driver's structured output enforces it: Ork's own declared-output
  check skips such a field, and the SDK driver's enforcement is unmeasured.
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
  `readyDriver`, so `ork resume` takes the one ready now, where the run itself
  took the SDK driver.
- **G25 · A leader's fork is unproven on a real session.** A child's question to
  its leader ([leader questions](./messaging/leader-questions.md)) is answered
  by a fork of the leader's session, tested only against stand-ins. The first
  real run must measure: (1) while the leader waits in `delegate`, its saved
  session ends with that pending call; whether `--fork-session` and the SDK's
  `forkSession` resume it cleanly; (2) what a fork reports as `total_cost_usd`:
  a resumed session reports its total so far, carried over from its transcript
  (ADR-046), and a fork copies that transcript, so it may report the leader's
  total plus its own; Ork counts the fork's whole report (as
  `<leader>/<fork session>`), which would overcount the run's spend and might
  trip the fork's `--max-budget-usd` at once; if it does, charge the report less
  the leader's last total; (3) the fork's tools and system prompt differ from
  the leader's, so each question reads the leader's session uncached; (4) that
  the structured report still comes back with `--tools Read,Grep,Glob`.
- **G26 · A node or project can't name the MCP servers it needs.**
  [Sessions](./runtime.md#what-a-session-loads) load only Ork's, or all of the
  machine's with `--machine-claude`; an `mcp:` on a node or the project could
  load just those it names (a browser, for G15).
- **G27 · A permission is answered one call at a time.** Each Bash command asks
  again (six in run 0427fb01); nothing allows a tool for the rest of a node.
- **G28 · An experiment has no way out.** Nothing promotes or removes one.

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
| L61  | [Parallel activations come back by position](./scheduler/calls-limits.md)                     | `for-each`  |
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

Found building [clean sessions](./runtime.md#what-a-session-loads) (ADR-065):

- **L180 · Only strict MCP is measured.** The $0.113 to $0.032 probe (CLI
  driver) measured `--strict-mcp-config`; the other two switches, and the SDK
  driver (checked against its types only), are unmeasured until the rerun.

## Chores

- **C2 · Release pull requests run no CI.** Pull requests opened with the
  built-in `GITHUB_TOKEN` trigger no workflows; the release workflow's full
  check still gates publishing. Kept on 2026-11-07 as a deliberate limit, since
  every other change goes straight to `main`. Open only until these words move
  into the [release runbook](../runbook/development/release.md).
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
