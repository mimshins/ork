# Built-in workflows

_Part of [The ork CLI](../cli.md)._

Status: **Built**: `ork:feedback-apply` and, as a bundle, `ork:security-audit`
([registry](../../packages/core/src/project/builtin-files.ts),
[bundles](../../packages/core/src/project/builtin-bundles.ts),
[tests](../../packages/core/test/builtin-workflows.test.ts),
[bundle tests](../../packages/core/test/builtin-bundles.test.ts),
[CLI tests](../../packages/cli/test/builtin-workflows.test.ts)).

## Ork's own workflows

`ork run <wf>` takes `ork:<name>`, one of the workflows Ork ships
([sources](../../packages/core/workflows/),
[ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)): today
`ork:feedback-apply` and `ork:security-audit`. Ork writes it into the project's
gitignored run folder, `.ork/runs/.builtin/<hash>/<name>.ork.yaml`, and runs
that file, so the run belongs to the project and resumes from the text it
started with. `validate` and `context explain` take the name too; an unknown one
is refused, naming the built-ins, and `ork:` completes to them.

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
- **Inside the project only.** The folder must be inside the project root for a
  read-only agent to read it. `ork:security-audit`'s first node, `scan`, refuses
  a folder outside it (an `ork register` project), naming `ork init`, before
  anything is spent ([audit limits](../gaps/audit-limits.md)). Resume and
  `validate` are unaffected.

## Bundle details

- **Hash.** `sha256(workflow)`, then each `[path, text]` in path order, taken
  before the placeholder is replaced. `ork:feedback-apply` has no companion
  files, so its folder hash is unchanged and old runs resume.
- **Node needs `package.json`.** Node 24 reads the ESM `.ts` scripts only when a
  `package.json` with `"type": "module"` sits beside them; the bundle ships one.
- **Generated modules.** `builtin-workflows.ts` and `builtin-bundles.ts` are in
  the oxfmt ignore list, as generated files.
