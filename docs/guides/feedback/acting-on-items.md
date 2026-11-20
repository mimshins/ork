# Acting on an item: lessons and fixes

_Part of [Feedback from your runs](../feedback.md)._

## Turning one into a lesson

When an item is something a workflow should simply know, accept it as a
**lesson**:

```sh
ork feedback accept 9fae0 --lesson -m "The spec is at nodes.spec.output.artifacts.spec."
```

Ork adds it as one line to `.ork/lessons/<workflow>.md` in the item's project,
and every later session of that workflow reads it, in the workflow layer of its
context. Without `-m`, the lesson is the item's title. The file is yours: commit
it, edit it, take a lesson out. If the item was seen in more than one workflow,
say which with `--workflow`. Without `--lesson`, `accept` only marks the item
accepted.

What you can do with an item depends on where it stands, the same in a terminal
and in the browser:

- A dismissed item takes nothing until you `restore` it.
- `accept` works only on a new or triaged item; a lesson can still be added to
  one already accepted, resolved or published.
- An item is published once, and has one `apply` at a time.

A workflow's lessons file is held to 1,500 tokens, as lessons cost tokens in
every session: accepting one that would pass that is refused, and a longer file
is cut there. `ork context explain <workflow> <node>` says when. Feedback about
Ork itself is never a lesson.

## Asking for a fix

When the fix belongs in the project, a line in `AGENTS.md`, a brief in a
workflow, a skill, ask Ork to propose it:

```sh
ork feedback apply 9fae0
```

This runs Ork's own workflow, `ork:feedback-apply`, in the project the item came
from (Ork names it before it starts), like any run you start: you see its
transcript, and it shows in `ork ps`, the Monitor and the Decisions panel.

A worker reads the item and that project's records of it, makes the smallest
change that would stop it happening, and Ork commits it on its own branch in a
worktree (uncommitted, with no branch, under `commit: never`). Feedback is model
output, and what a repository's sessions wrote can try to steer the worker, so
the worker can only read and edit files; it runs no commands.

Then you're asked: **keep** or **discard**. The question shows what the fix
changes (`git diff --stat`) and the command to read the whole of it. **Read the
diff before you keep it**: the worker's own account of it comes last, and is
only its claim.

- **Keep:** the branch stays, and the item is resolved. Review and merge it like
  any other change: Ork never merges it. If the branch holds no new commits,
  there's nothing to keep: Ork removes it and its worktree, and the item stays
  accepted. Under `commit: never`, keep copies the fix into your checkout,
  uncommitted; if it clashes with your changes there, nothing is copied.
- **Discard:** the branch and worktree go; the item stays accepted.

When the project's `.ork/project.yaml` sets `knowledge: ork-only`, the worker
may write only under the project's `.ork/` folder (workflows, skills, context).
A write anywhere else, and any file named `CLAUDE.md` or `AGENTS.md` even under
`.ork/`, is refused with a reason the worker sees; if the fix belongs outside
`.ork/`, it changes nothing and reports why. Claude Code, Codex, Command Code
and omp enforce this; OpenCode cannot, so it refuses the run. In a project
registered from outside, whose Ork folder is not in the repository,
`ork feedback apply` is refused under this rule with a message naming it: make
the change by hand
([Projects](../projects/attached-projects.md#keeping-ork-out-of-your-repositorys-knowledge)).

If the worker finds nothing to change, it says why and the item stays accepted.
Feedback about Ork itself has no fix in your project, and an item already
resolved, published or dismissed isn't applied again.
