# Worktrees

_Part of [The panels](./panels.md)._

What `ork worktrees` shows, for every project Ork knows, with cleanup a click
away ([panel](../../packages/ui/src/panels/worktrees-panel.tsx),
[tests](../../packages/ui/test/panels/worktrees-panel.test.tsx),
[dialog tests](../../packages/ui/test/panels/worktrees-dialogs.test.tsx)), from
the [worktrees routes](../server/api.md), in core's words, the
[CLI's](../worktrees.md#ork-worktrees). It's the eleventh panel, after Feedback,
so it has no Go to digit; its tab sits after Feedback in the bottom group.

- **The list** is read when the panel shows, after every remove or clean, on
  **Reload**, and when the runs change while it shows, at most every 5 s; a
  change made outside Ork shows on **Reload** ([L155](../worktrees/limits.md)).
  One card per project with something left, in the filter's name order, its
  heading the project's name with its path, the branch "merged" is measured
  against and its count; under the cards, "Nothing left in N other projects." A
  project git can't read keeps its card, with its words in place of the list
  (and no branch), and, for a registered project whose folder is gone,
  `ork projects move` as a command block. "Updating…" is a polite status;
  **Reload** keeps its name after a failed read, which an alert says once, and
  Clean merged… then says why it waits.
- **A row** is the item's name (its branch, or its run and node when detached),
  a merge badge (`merged`, `not merged`, `detached`: a glyph and a word), then
  its run and node, path, and state as core words it; work removing would lose
  (uncommitted changes, commits on no branch) is a heavier weight, never a
  color. A merged row that Clean merged… would keep says why. **Open run** is
  named for its run and node, and disabled when Ork has no records of the run;
  **Remove…** (or **Delete branch…** for a branch with no worktree) is named for
  the row, described by its state and its CLI twin, and disabled, with its
  reason in its name and tooltip, for the main checkout's branch or a run still
  going: the reasons come with the list, by the rule the remove route keeps. ↑ ↓
  Home End move between rows' same buttons; Tab reaches each.
- **Project filter:** `All projects` or one, the panel's own, for the page's
  life; a change says the count aloud.
- **Remove…** opens on Cancel and only reads: the facts (project, run with
  **Open run**, path as text to select, and state as the plan read it), **Also
  delete the branch** (off; described by what deleting it loses), the plan in a
  well, and the twin `ork worktrees remove …`, which gains `--branch` and
  `--force` with the plan. When nothing is lost its action (**Remove worktree**,
  **Remove worktree and branch**, **Delete branch**, **Prune**) removes it. When
  it loses work, the action is **Continue…** and the next step shows what's lost
  (git's lines, the first 20 of each, in wells the keys can scroll), its heading
  taking the focus, then **Remove and lose this work** (danger), with **Back**.
  The removal hands the plan's digest back; a plan that changed since is refused
  (409), read again, and shown with the focus on its action. Done, the row
  leaves, the removal is said aloud, and the focus goes to the same button in
  the row now in its place, or the empty state's title when none is left. It
  changes only its own item: a missing worktree is dropped by its own path,
  never by a prune of every one. A plan that couldn't be read says so, in its
  well and in the action's reason, rather than seeming to read. While it removes
  it can't be closed.
- **Clean merged…** reads each project's plan with the CLI's default filter
  (merged only, never forced), one confirm across the projects in scope: a
  summary (what goes, what's kept and why), the plan's lines in a well (where
  the focus starts), **Also delete the merged branches** (off), and each
  project's twin `cd <root> && ork worktrees clean`. The action counts what it
  does (**Remove 2 worktrees**); with nothing to do it's gone and Cancel reads
  **Close**. Its digest guards it as Remove's does; the result's heading takes
  the focus, and a project that stopped partway says where and what was done
  before. Cancelled, it says nothing was removed.
- **Won't do:** `clean --all`, `--force` and `--run` in bulk, and `--yes`;
  unmerged or dirty work goes one row at a time, through the explicit confirm
  ([L156](../worktrees/limits.md)).
