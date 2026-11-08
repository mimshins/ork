# What's new

Each release in a few lines, newest first, with how to upgrade. Every change, in
full: the [changelog](../packages/cli/CHANGELOG.md).

## 1.0.0-alpha.1

- **Clean Claude sessions.** A run's sessions no longer load your machine's MCP
  servers or Claude's memory, only your repository's setup and Ork's own: a
  server reconnecting mid-session made Claude rewrite its prompt cache, which
  cost the first measured run several times its work. `ork run --machine-claude`
  (or "Use this machine's Claude setup" in `ork ui`) brings them back for a run
  that needs them, and the run keeps it on resume
  ([what a session loads](./guides/running-workflows/running-and-answering.md#what-a-session-loads)).

## 1.0.0-alpha.0

The first step toward 1.0.0. Alphas come first, then betas and release
candidates, each also published as `latest`, so a plain install gets it and
`ork upgrade` offers it. Expect the workflow format and commands to keep
changing until 1.0.0.

- **Set Ork up through your agent.** The `/ork:setup` skill, or any MCP client,
  installs Ork, sets up the project and checks the logins
  ([with your agent](./getting-started/with-your-agent.md)).
- **Say what to change when you answer.** `ork decide … --say "…"`, or the note
  box in the Decisions panel, gives your answer a note the run reads, such as
  what to revise
  ([answering questions](./guides/running-workflows/running-and-answering.md#answering-questions)).
- **A leader can answer its children's questions.** With `questions: owner`, a
  child's question goes to a copy of its leader's session first, which answers
  it or passes it on to you
  ([leaders](./guides/leaders-and-delegation.md#a-leader-can-answer-its-childrens-questions)).
- **The driver is chosen when you run.** A workflow that names no Claude driver
  runs on the one that's ready on your machine, so a committed workflow works on
  every teammate's; `ork run` says which.
- **A run never ends `succeeded` without reaching its end.** A run whose join
  waited on a branch that couldn't run used to finish early as succeeded.
- **Tab completion.** `ork completion zsh` (or `bash`, `fish`) prints a script
  that completes commands, flags, workflows, run ids and node ids; `ork --help`
  lists the commands in groups ([tab completion](./guides/tab-completion.md)).
- **Every channel in the update check.** The daily check, `ork upgrade` and the
  banner in `ork ui` offer the newest version across `latest`, `alpha`, `beta`
  and `rc`.

### Upgrading from 0.4.x

```sh
ork upgrade
```

- Your workflow files need no changes. A workflow that names no Claude driver
  now runs on the one that's ready (the CLI driver when both are), where it used
  to take the SDK driver. A run started before you upgraded recorded no driver,
  so resuming it uses the one ready now.
- To stay on 0.4, see
  [staying on a version](./getting-started/installation.md#updating).

## 0.4.0

The feedback loop, end to end: Ork notes what got in your runs' way, and you can
now act on it.

- **Lessons.** Turn a feedback item into one line every later session of its
  workflow reads: `ork feedback accept <item> --lesson`
  ([lessons](./guides/feedback.md#turning-one-into-a-lesson)).
- **Have Ork propose a fix.** `ork feedback apply <item>` runs Ork's own
  `ork:feedback-apply` workflow, which makes the change on a branch and asks
  whether to keep it
  ([asking for a fix](./guides/feedback.md#asking-for-a-fix)).
- **Merge the same problem.** `ork feedback triage` merges items about the same
  thing, after asking; `ork feedback split` takes a merge apart
  ([merging](./guides/feedback.md#merging-the-same-problem)).
- **Share feedback about Ork.** `ork feedback publish <item>` shows exactly what
  it would post to Ork's Discussions and sends nothing unless you say yes;
  `export` and `import` move feedback as JSON lines
  ([sharing](./guides/feedback.md#sharing-feedback-about-ork)).
- **Note a node as you answer.** `ork decide … --note "…" --rating bad` notes
  how the node went
  ([answering questions](./guides/running-workflows/running-and-answering.md#answering-questions)).
- **New panels in `ork ui`:** Feedback, Worktrees, and Context, which shows what
  a node's session is told and follows the Builder as you edit
  ([the panels](./guides/browser-view/panels-and-workspace.md#the-panels)).
  **Note…** in the Monitor adds your own feedback.
- **Upgrade from the browser.** A banner says when a newer Ork is out, upgrades
  it, and restarts `ork ui` on the new version
  ([new versions](./guides/browser-view/new-versions.md)).
- **Commands you can copy.** The browser view shows every command as a block
  with a copy button.
- **`ork worktrees remove`** removes one worktree or branch, and a safer
  `ork worktrees clean` never takes a running run's worktree, nor git's record
  of your own worktrees ([cleaning up](./guides/worktrees.md#cleaning-up)).
- **Ork's own workflows** run by an `ork:` name, such as `ork:feedback-apply`.

### Upgrading from 0.3.0

```sh
ork upgrade
```

- Your workflow files need no changes.
- Restart `ork ui` if it's running. From 0.4.0 on, the page's banner does this
  for you.
- If you wrote Ork's skills for Claude Code into a project, write them again to
  get the new ones; `ork doctor` says when they're old:

  ```sh
  ork init --skills
  ```
