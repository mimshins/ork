# A run's own root

_Part of [Worktrees: where nodes work](../worktrees.md)._

Status: **Built** ([run-root.ts](../../packages/core/src/worktree/run-root.ts),
[the CLI side](../../packages/cli/src/run/run-root.ts),
[core tests](../../packages/core/test/run-root.test.ts),
[CLI tests](../../packages/cli/test/run-root.test.ts)). Why:
[ADR-100](../../decisions/ADR-100-audit-in-attached-projects.md).

A run can work in a worktree of its own instead of the project checkout. Only a
built-in with companion files (`ork:security-audit`, `ork:onboard-propose` and
`ork:onboard-write`), run in a project attached with `ork register`, does so:
the bundle must sit inside the folder a read-only agent reads, and Ork never
writes it into the user's repository
([built-in workflows](../cli/built-in-workflows.md#bundles)). An in-repo project
(`ork init`) and a built-in without companion files (`ork:feedback-apply`) have
no run root and work as before. The root is not only the audit's: its id and
folder are still named `audit-root` ([L545](../gaps/onboard-limits.md)), and a
worktree node of the run, such as `ork:onboard-write`'s writer, is cut from it
(its folder is `ork-<run>-audit-root-worktrees/`, left empty after a discard:
[L546](../gaps/onboard-limits.md)). A **seeded** run
([seeding](../worktrees.md#seeding-a-worktree), `ork onboard` in an attached
project) opens its root detached too (`commit: never`), so no branch appears.

- **Opened before the first node.** After the preflight, `ork run` makes a
  worktree from the base ref the caller gave, else the run's recorded commit on
  a resume, else what `git.base` names (the project's `HEAD` by default; it is
  rendered with no inputs). It is named by the project's
  [git rules](../project-rules.md) like any node's, beside the clone
  (`../<clone>-worktrees/ork-<run>-audit-root` on branch `ork/<run>/audit-root`;
  detached under `commit: never`). Then the bundle the workflow file sits in
  (`runs/.builtin/<hash>/` under `~/.ork/projects/<id>/`) is copied into it as
  `.ork/runs/.builtin/<hash>/`, plain files only, through the same link guard as
  any bundle; its placeholder already names that folder relative to a root. A
  failure, such as no git repository, a failed `git worktree add` or a refused
  path, stops `ork run` with exit 1 before any node, naming the cause.
- **From the repository's top.** A project in a repository subfolder (`<root>`
  is `<top>/sub`) opens its run root from the repository's top, not from its own
  folder: the root passed to `openRunRoot` is `place.root` joined with `..` for
  each segment of the prefix (`git rev-parse --show-prefix`), so the root and
  the run's worktrees are named beside the clone and never land inside its
  working tree. At the top the prefix is empty and nothing changes. The recorded
  base is `place.root`'s, as before. `finish` reads this top as the tool nodes'
  folder ([L547](../gaps/onboard-limits.md)).
- **No fetch, no readonly worktree.** The root is handed its base, so
  `git.fetch` does not run, and `git.readonly: base` opens nothing: the root is
  already a worktree at the base.
- **No ignored local files.** `createWorktree` takes `copyLocal` (default true);
  only the run root passes false, so files `.worktreeinclude` names (for example
  `.env`) never reach it. A test needs a `.worktreeinclude` to prove it.
- **Every node works there.** The workspace root, each session's folder and each
  tool node's folder are the worktree; no node works in the user's checkout. The
  store, the events, the locks and the report folder
  (`~/.ork/audits/<project>/`) stay keyed by the checkout.
- **`ORK_SOURCE_ROOT`.** Tool nodes get the user's checkout in this variable,
  only when the root is a run worktree. It is set like `ORK_RUN`, so a
  workflow's `env:` cannot set it and a nested run does not inherit it.
- **Closed on every end.** The worktree is removed when the run finishes, fails,
  is stopped or discarded, and by the crash handler, before the run reports. The
  removal is forced (the worktree holds untracked files Ork wrote); the branch
  is deleted only while it still points at the base, so no commit is lost.
- **Findable after a crash.** The open and the close are `worktree` events
  (`created`, `removed`) under the id `audit-root`, so a worktree a crash left
  is listed by `ork worktrees` and removed by `ork worktrees clean`, matched by
  its run id.
- **Resume.** `ork resume` re-creates the worktree at the **recorded** commit,
  so the audited commit is the same, and copies the same bundle again: the one
  the run started with, so a run started before an Ork upgrade resumes with its
  own files, not the newer Ork's (whose hash differs). If the folder is still
  there it is adopted.
- **What it does not hold.** The worktree is a clean checkout, so uncommitted
  changes and the untracked or ignored files of the checkout (`.env`, keys) are
  not in it. A `post-checkout` hook of the repository runs when it is checked
  out, as for every worktree node.
