# Starting from a fresh base

_Part of [Worktrees and isolation](../worktrees.md)._

Two [project rules](../project-rules.md#your-own-branch-and-worktree-names) make
a run start from the branch you name, not from whatever your checkout holds:

```yaml
git:
  base: origin/main
  fetch: auto # the default; or never
  readonly: base # or checkout, the default
```

- **`fetch`.** With `auto`, a remote `base` such as `origin/main` is fetched
  before the run starts, so worktrees begin from the remote's newest commit.
  Only that one branch is updated: no tags, no pruning, nothing pushed, and no
  checked-out branch moves. It uses your own git credentials and never asks for
  one. `HEAD`, a local branch, a tag or a commit is never fetched, and neither
  is a resumed run's base. If the fetch fails (offline, no access, over 60
  seconds), the run stops before any node and says why; set `fetch: never` to
  use what you last fetched.
- **`readonly`.** A readonly node with no owner and no input's worktree reads
  your checkout, which may be on another branch. With `base` it reads one
  detached worktree at the base commit instead, shared by the run's readonly
  nodes, with committed files only (no `.env`), removed when the run ends. A
  readonly node with an owner or an input's worktree still works there, and
  `--in-place` opens none.

For the full rules: [fetching the base](../../../specs/project-rules/fetch.md).
