# Limits: the context inspector

_Part of [The panels](./panels.md)._

What the UI's Context panel says for now, by choice
([context](./panels-context-and-feedback.md#context),
[server](../server/api.md)).

- **L146 · A run's node is planned from the project as it is now, in place.**
  Nothing records what a session loaded when it started, so the panel plans the
  node again from the run's workflow file and the project's main checkout, not
  the run's worktree, whose branch can hold other files. It names each file
  behind the stack, and each skill and context folder, changed after the run
  started, as the maintainer chose over a snapshot of each session.
- **L147 · A file taken away isn't always noticed.** A folder's time changes
  when a file in it is added or removed, so the user and project skill folders
  and `~/.ork/context` catch those; a `CLAUDE.md` or `AGENTS.md` deleted from
  the project's root, or a named context file deleted, isn't named as changed.
  The stack still shows what's there now.
- **L148 · Its files are read where they're named.** The texts come from the
  files the planner reads for `ork context explain`, inside the project and
  `~/.ork`, checked by their paths; a symlink inside the project to a file
  outside it is read too. The API needs its token, which can already start runs,
  so this shows nothing that token couldn't reach.
