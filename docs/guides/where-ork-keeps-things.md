# Where Ork keeps things

Ork runs on your machine and keeps what it knows there: in your home folder, and
in each project. This page lists what's where, the few things that leave your
machine, and how to remove Ork cleanly.

## In your project: `.ork/`

`ork init` makes it. Commit it with your code, except `runs/`:

| Path                 | What it holds                                                            |
| -------------------- | ------------------------------------------------------------------------ |
| `workflows/`         | your workflows, `<name>.ork.yaml`                                        |
| `agents/`, `skills/` | your agents and skills ([agents](./agents.md))                           |
| `lessons/`           | lessons from feedback, one file per workflow ([feedback](./feedback.md)) |
| `project.yaml`       | your [project rules](./project-rules.md)                                 |
| `triggers.yaml`      | what starts runs on its own ([watching](./watching.md))                  |
| `runs/`              | each run's files; gitignored, as `ork init` sets up                      |

A run's folder, `.ork/runs/<run>/`, holds long tool output, the output of a run
started with `--detach`, and `events.jsonl`, a copy of the run's events.

A project you attached with `ork register` keeps the same files in
`~/.ork/projects/<id>/` instead, and Ork writes nothing into its repository
([projects](./projects.md)).

Runs also leave git branches `ork/<run>/<node>`, and worktrees beside your clone
(`../<clone>-worktrees/`) ([worktrees](./worktrees.md)).

`ork once` keeps its passes in your repository's git folder,
`<git-dir>/ork-once/`: outside `.ork/` and `~/.ork/`, shared by every worktree
of the repository, and pruned past 7 days or 500 entries. Each holds a hash of
the files, the check's name, a time and who ran it
([run a check once](./running-workflows/several-runs.md#run-a-check-once-ork-once)).

## In your home folder: `~/.ork/`

| Path                             | What it holds                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `state.db`                       | every run's record, your feedback and [follow-ups](./follow-ups.md), usage, the Builder's drafts, and the projects Ork knows |
| `settings.yaml`                  | your own settings, such as [quotas](./models-and-budgets/across-runs-and-time.md#limits-across-runs)                         |
| `agents/`, `skills/`, `context/` | your own agents, skills and notes, for every project                                                                         |
| `projects/`                      | projects attached with `ork register`                                                                                        |
| `ui.json`                        | `ork ui`'s address and sign-in token while it runs, readable only by you                                                     |
| `update-check.json`              | when Ork last asked for a newer version, and the answer                                                                      |
| `sockets/`                       | one socket per live run, so commands reach it at once                                                                        |
| `watch/`                         | `ork watch`'s own files, when you use it                                                                                     |

The browser keeps its own few things for `ork ui`: your layout, theme, what
you've read, and a banner you dismissed.

## What's stored about a run

`~/.ork/state.db` keeps, for each run: the workflow and its inputs; every event,
which is what each agent said, each tool call with its input and result, and
each worktree; the questions asked and who answered what; tokens and cost; and
feedback. Values a workflow reads from your environment with `{{env.NAME}}` are
masked before anything is written. Claude Code keeps each session's own files,
as it does when you use it directly.

To forget old runs while keeping what they spent:

```sh
ork prune --older-than 90d
```

## What leaves your machine

Your sessions talk to Claude, and your tool nodes run your own tools, which
reach what they reach. Ork itself sends only:

- **The daily version check.** Once a day, Ork asks the npm registry which
  version is newest, and sends nothing about you or your projects. Turn it off
  with:

  ```sh
  export ORK_NO_UPDATE_CHECK=1
  ```

  More in [updating](../getting-started/installation.md#updating).

- **Feedback you publish.** `ork feedback publish` posts one item to Ork's
  GitHub Discussions, with your own `gh`, only after showing you exactly what it
  would send and you say yes
  ([sharing](./feedback.md#sharing-feedback-about-ork)).

`ork upgrade`, when you run it, runs your package manager, which downloads the
new version.

## Removing Ork

1. In each project, remove the worktrees and branches runs left. This asks
   first; add `--force` to drop work that isn't merged too:

   ```sh
   ork worktrees clean --all --branches
   ```

2. If you set up `ork watch` as a service, stop it and delete its file
   ([keeping it alive](./watching.md#keeping-it-alive)).
3. In Claude Code, remove the plugin, or the `ork` server you added:

   ```
   /plugin uninstall ork@ork
   ```

   ```sh
   claude mcp remove ork
   ```

4. Uninstall the command, with the package manager you installed it with:

   ```sh
   npm uninstall --global @krapht/ork
   ```

5. Delete what Ork kept in your home folder:

   ```sh
   rm -rf ~/.ork
   ```

6. In each project, delete `.ork/`, the `.ork/runs/` line in `.gitignore`, and
   the links `ork link` made, such as `.claude/agents` when it points at
   `.ork/agents`.
