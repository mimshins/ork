# Built-in workflows

_Part of [The ork CLI](../cli.md)._

Status: **Built**: `ork:feedback-apply`, `ork:onboard-propose` and
`ork:onboard-write` (run by [`ork onboard`](./onboard-verbs.md), where each has
its own caps; [ADR-097](../../decisions/ADR-097-onboarding-workflows.md)) and,
as a bundle, `ork:security-audit`
([registry](../../packages/core/src/project/builtin-files.ts),
[bundles](../../packages/core/src/project/builtin-bundles.ts),
[tests](../../packages/core/test/builtin-workflows.test.ts),
[bundle tests](../../packages/core/test/builtin-bundles.test.ts),
[CLI tests](../../packages/cli/test/builtin-workflows.test.ts)); in an attached
project it runs in a [worktree of its own](../worktrees/run-root.md)
([run root tests](../../packages/cli/test/run-root.test.ts)).

## Ork's own workflows

`ork run <wf>` takes `ork:<name>`, one of the workflows Ork ships
([sources](../../packages/core/workflows/),
[ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)): today
`ork:feedback-apply`, `ork:onboard-propose`, `ork:onboard-write` and
`ork:security-audit`. Ork writes it into the project's gitignored run folder,
`.ork/runs/.builtin/<hash>/<name>.ork.yaml`, and runs that file, so the run
belongs to the project and resumes from the text it started with. `validate` and
`context explain` take the name too; an unknown one is refused, naming the
built-ins, and `ork:` completes to them.

## Bundles

A built-in can be a bundle
([ADR-096](../../decisions/ADR-096-built-in-bundles.md)): the workflow plus
companion files. `ork:security-audit` carries the vendored security-audit skill,
a read-only rule and the `tools/audit` scripts.

- **One folder, one hash.** The workflow and every companion file are written
  under the same `.ork/runs/.builtin/<hash>/`. The hash covers the whole bundle,
  so a changed companion file gives a new folder, an unchanged bundle is not
  rewritten, and a resume reads the exact bundle its run started with.
- **A placeholder for the folder.** The texts name their own folder with one
  placeholder, replaced when written with the folder **relative to the project
  root** (`.ork/runs/.builtin/<hash>`). The hash is taken before the
  replacement. `context:` refs use plain paths relative to the workflow file.
- **A guard on every path.** Each file is written by rename and never through a
  link; a link on any path of the bundle (or on `.ork/runs/.builtin`) is refused
  and nothing is written, as ADR-059 does for one file.
- **Generated.** The companion texts are a generated module; a test fails when
  it is stale.
- **In an attached project, in a worktree.** A read-only agent reads only inside
  its own folder, and an `ork register` project keeps Ork's folder outside the
  checkout. So `ork run` of a bundle there opens a worktree of `HEAD` beside the
  clone, writes the bundle into it as `.ork/runs/.builtin/<hash>/` (the
  placeholder then names that folder relative to the worktree), and runs every
  node in it; the user's repository is never written to, and the worktree is
  removed when the run ends ([a run's own root](../worktrees/run-root.md),
  [ADR-100](../../decisions/ADR-100-audit-in-attached-projects.md)). An in-repo
  project has no such worktree. The audit then sees `HEAD`, not uncommitted
  changes ([audit limits](../gaps/audit-limits.md)). The other built-ins with
  companion files, `ork:onboard-*`, stay refused in an attached project
  ([ADR-099](../../decisions/ADR-099-onboard-refuses-attached-projects.md)).
- **`ORK_SOURCE_ROOT`.** Tool nodes of such a run get the user's checkout in
  this variable, only when the run's root is a worktree of its own. `scan` reads
  it and adds the notes `audited commit <sha> (a per-run copy of HEAD)` and,
  when `git status --porcelain` of that checkout is not empty,
  `uncommitted changes in your checkout are not audited`; both reach the report.
  Without it (an in-repo project) `scan` adds neither.

## Bundle details

- **Hash.** `sha256(workflow)`, then each `[path, text]` in path order, taken
  before the placeholder is replaced. `ork:feedback-apply` has no companion
  files, so its folder hash is unchanged and old runs resume.
- **Node needs `package.json`.** Node 24 reads the ESM `.ts` scripts only when a
  `package.json` with `"type": "module"` sits beside them; the bundle ships one.
- **Generated modules.** `builtin-workflows.ts` and `builtin-bundles.ts` are in
  the oxfmt ignore list, as generated files.
