# A fresh session for a builder's next task

A worker with `session: resume` that its owner delegates to again picks up its
old session, however long it has grown. Every later turn then reads the whole
conversation again, from the prompt cache. A project can ask Ork to start that
next task in a **fresh session** once the old one has grown past a size you
choose. It is off until you turn it on.

## Turning it on

```yaml
# .ork/project.yaml
sessions:
  freshOver: 100000 # tokens; never (the default) turns it off
```

`freshOver` is a count of tokens, 1 or more, with no upper limit. A workflow can
set its own under `rules:`, and its value wins over the project's:

```yaml
rules:
  sessions: { freshOver: 150000 }
```

`ork validate` refuses `0`, a negative number, a fraction or any other word, and
points at the line. The rule is the project's or the workflow's, not a node
field: one role cannot differ from another inside a workflow.

## When a node starts fresh

All of these must hold, or the node resumes as it always has:

- Its owner delegated the task. A node sent round a loop again always resumes.
- It is an `agent.worker` with `session: resume`. A child leader keeps resuming.
- Its last task in this run ended `done`. A worker that was stopped, hit a limit
  or reported `fail` is most likely asked to finish or fix that task, so it
  resumes, whatever its size.
- The size of that session, its context, is over `freshOver`. The context is the
  prompt of the session's last model request. `claude-code`, `open-code`,
  `command-code` and `omp` report it; `codex` does not, so a `codex` worker
  always resumes.

Ork decides this by counting, with no model turn.

## How it differs from `session: fresh`

`session: fresh` starts a new session on **every** re-entry, whatever its size,
and forgets everything. This rule is only for a **new delegated task** after the
session has grown past the threshold, and the new session is told what the
builder did before.

## What the fresh session knows

It runs in the same worktree and branch, so the files its earlier tasks left are
there. Its prompt is the node's own prompt, then a section headed
`## Your earlier tasks in this run`, then the new task. The section lists the
node's earlier tasks and the summaries it reported, newest first, in at most
8,192 characters; it says how many older ones were left out. Ork builds it from
text the node already had, with no model, and puts it in the prompt only.

A task that is a fix to the builder's own last one arrives like any new task, so
it starts fresh too; the builder has that note and the checkout to go on.

## What you see

`ork logs` adds a second line under the node's start when it happens, and
`--json` carries the sizes (`fresh` on the `node.started` event):

```
build │ agent.worker, for lead · add the parser
      │ starts a fresh session: context 120000 tokens over 100000
```

`ork chat <run> <node>` reaches the node's newest session, the fresh one.

## What it costs and saves

A fresh session writes its start to the cache again and reads less each turn. In
past runs this would have saved about 7% of what builders cost, nearly all in
the few sessions that took four to seven tasks; small runs gain nothing or lose
a little. The effect on quality, a builder that has forgotten what it learned,
is not measured yet.
[Counted tokens](./models-and-budgets/models-and-limits.md#budgets-in-tokens) go
up.

For the full rules: [fresh sessions](../../specs/scheduler/fresh-sessions.md)
and [the sessions rule](../../specs/project-rules/sessions.md).
