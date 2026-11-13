# Next release

_Part of [What's new](../whats-new.md)._

- **Task labels show everywhere, masked.** A leader's task `description` folds
  whitespace to one space, has secrets masked (such as a `ghp_…` token) before
  it is clipped to 80 characters, counted by code point so an emoji is never cut
  in half, and `ork tree` lines its columns up by code point. The live run
  stream, the lead's `delegate` tool-call line, `ork tree` and `ork logs` mask
  it too, and `ork tree --help` and `ork logs --help` describe it. In `ork ui`
  the Monitor's node table shows the label on one line with an ellipsis and the
  whole text on hover, and a graph card shows it on a third line, so cards are
  now 60 px tall ([guide](../guides/leaders-and-delegation.md)).
- **Tool arguments and delegation are harder to misuse.** A tool node's argument
  that starts with a `{{nodes.<id>.output…}}` value which begins with `-` now
  fails the node ("argument from nodes.a.output starts with `-`; put `--` before
  it in the command"), so a node's output can't pass an option to the program;
  write `git show -- {{nodes.a.output.ref}}`. Two `delegate` calls at once for
  one child start it once, and the other gets `already running`. On OpenCode,
  Ork allows its own tools by their exact names, so a project MCP server named
  `ork_<something>` no longer gets them allowed
  ([tool nodes](../guides/writing-workflows.md#tool-nodes)). Upgrade: a tool
  node whose output-fed argument can start with `-` needs a `--` before it.
- **`ork ui` signs in with a one-time code.** `ork ui` now gets a single-use
  code from the server (good for a minute) and opens `/?code=…`; the long-lived
  key that `ork mcp` and scripts use is no longer in the link, on the browser
  opener's command line or in the browser's cookie, which holds a separate
  secret. A used, expired or wrong link says "That sign-in link is not valid any
  more; open it again with `ork ui`." A request path that began with `//` no
  longer redirects off the server. Upgrade: a browser signed in before, an old
  `?token=` link, and a tab left open while an older `ork ui` restarts onto this
  version (its old supervisor sends no session secret) stop working once; run
  `ork ui` again. If the running `ork ui` is from an older Ork, `ork ui` says to
  stop it and run it again
  ([guide](../guides/browser-view/starting-and-commands.md#how-it-keeps-other-sites-out)).
- **Wider secret masking.** Stored events, feedback and follow-ups now also mask
  npm tokens (`npm_…`), `sk-proj-` and Google (`AIza…`) keys, Stripe live keys
  (`sk_live_`, `rk_live_`), and the value after `password`, `passwd`, `secret`,
  `token` or `api_key` written `key=value`, `key: value` or `"key": "value"`
  when it is 8 characters or more. Feedback and follow-ups also mask the values
  of the run's configured `env:` secrets, and so does a note you type with
  `ork feedback note`, `ork decide --note` or in the browser
  ([masking](../../specs/event-store.md#masking)).
- **Take every due follow-up into a run.** `ork run start --follow-ups due`
  takes each agent follow-up that is due in the project as the run's brief
  (alone or beside ids; with nothing due the run doesn't start). A bare
  `--follow-ups` now says it needs ids or `due`, instead of "missing required
  input brief", and Tab after it offers `due` and the open agent follow-ups with
  their titles ([guide](../guides/follow-ups.md#having-an-agent-do-one)).
- **The browser view and `ork mcp` filter like the CLI.** Runs, Decisions,
  Follow-ups, Feedback, Worktrees and Usage share one filter bar made from the
  same fields as the flags (`status`, `workflow`, `project`, `since`, `until`,
  `kind`, `severity`, `due`, `for`, `run`), a wrong value shows the CLI's
  message, and the bar shows the matching `ork` command. The `runs`, `usage` and
  `decisions` tools of `ork mcp` take the same fields
  ([guide](../guides/filtering-lists.md#in-the-browser-and-ork-mcp)).
- **A leader can label its tasks.** `delegate` and `spawn_worker` tasks take an
  optional `description`, a few words that Ork folds to one line, masks of
  secrets and clips to 80 characters, and shows beside the child's id in
  `ork tree`, `ork logs` and the browser view. Before, a model that added one
  had its first turn rejected. Also: `issues=01,1` counts one issue, a label
  whose open issues are all taken says so instead of "No open issue found", and
  a resumed session no longer blames the run's dollar budget for what it spent
  before the turn ([guide](../guides/leaders-and-delegation.md)).
- **One way to filter every list.** `ork ps`, `usage`, `decide --list`,
  `follow-ups list`, `feedback list`, `worktrees list`, `agents list`,
  `projects` and `logs` share their filter flags: `--status`, `--workflow`,
  `--project`, `--since` and `--until` (an age like `30d` or a day like
  `2026-11-01`) where they fit, `--limit`, `--json`, and a new `--ids` that
  prints ids on one line for scripts (`ork ps --status failed --ids`). Wrong
  values are refused with the allowed ones, and Tab completion offers them.
  `--all` meant three things and is removed from these lists: use
  `--project all` on `ps`, `usage`, `decide` and `follow-ups list`, and
  `--status all` on `feedback list`; `prune --all` is unchanged. A list refuses
  a flag it doesn't have, an argument error prints one line instead of the help,
  `--run` takes the start of a run id, `ork ps --json` adds `live`, and
  `ork mcp` refuses an unregistered project and a bad `limit`
  ([guide](../guides/filtering-lists.md)). Upgrade: change scripts that use
  `--all` or pass a flag a list doesn't have.
- **Follow-ups: what a change leaves for later.** A message to a partner, work
  for another project's agent, infra steps and a check after deploy are kept as
  follow-ups, apart from feedback: sessions leave them with a new `follow_up`
  tool, `ork follow-ups` lists, shows, adds and closes them, and the Follow-ups
  panel does the same with a due count on its tab. Your project's new
  `followUps` rule keeps them in Ork's store, in a file in your repository, or
  as GitHub issues. An `after-merge` one becomes due when your own `gh` shows
  its pull request merged. Ork drafts messages and never sends them: you send
  them, or confirm a comment on an issue.
  `ork run <workflow> --follow-ups <ids>` takes the agent ones as a run's brief,
  and `build` asks you once what to do with the ones it finds
  ([guide](../guides/follow-ups.md)).
- **Work GitHub issues in parallel.** `ork run issues --input label=ready`
  builds and reviews each issue in its own worktree, integrates the ones that
  pass one at a time into one branch, and opens one pull request that closes
  them. A node's new `lock: <name>` is what orders runs onto a branch: a run
  that waits says "waiting for <lock>, held by <run>/<node>", and an agent
  resolves a rebase conflict, asking you only when it changes what a reviewed
  change does. `ork init --issues` adds the workflow; `ork doctor` clears stale
  locks ([guide](../guides/issues-in-parallel.md)).
- **Agent nodes are `agent.*`, and a model can name its driver.**
  `claude.worker`, `claude.leader` and `claude.subagent` are now `agent.worker`,
  `agent.leader` and `agent.subagent`, and a `model` may start with its driver:
  `claude-code.opus`, `open-code.anthropic/claude-sonnet-5-5`. A prefixed node
  needs no `driver`, and `--driver` doesn't change it. Plain models still work.
  Upgrading: run `ork migrate` in each project; it rewrites the old type names
  in your workflows and shows each change (`--dry-run` only shows them).
  `ork validate` and `ork run` refuse the old names until you do
  ([drivers](../guides/drivers.md#naming-the-driver-in-the-model)).
