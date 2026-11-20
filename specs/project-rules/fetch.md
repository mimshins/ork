# Fetching the base

_Part of [Project rules](../project-rules.md)._

Status: **Built**: the two git keys `fetch` and `readonly`
([project.ts](../../packages/schema/src/project.ts),
[rules.ts](../../packages/core/src/project/rules.ts)), the fetch
([fetch.ts](../../packages/core/src/worktree/fetch.ts),
[tests](../../packages/core/test/fetch-base.test.ts)) and the shared read-only
worktree ([readonly-base.ts](../../packages/core/src/worktree/readonly-base.ts),
[tests](../../packages/core/test/worktree-readonly-base.test.ts)). Why:
[ADR-107](../../decisions/ADR-107-fetch-the-base-and-read-it-readonly.md).

A run starts from the base the project names, not from a stale or wrong
checkout.

```yaml
git:
  base: origin/main
  fetch: auto # auto | never
  readonly: checkout # checkout | base
```

## Fetching

`fetch: auto` (the default) fetches a remote `base` before the run resolves it.

- **Only a remote-tracking ref is fetched.**
  `git rev-parse --symbolic-full-name` decides: `refs/remotes/<remote>/<branch>`
  is one; `HEAD`, a local branch, a tag or a commit is not, even a local branch
  whose name starts with a remote's. A ref that does not resolve yet is a remote
  ref when its first segment is a configured remote (the longest wins).
- **One branch, one ref.**
  `git fetch --no-tags <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>`
  updates only that tracking ref: no tags, no prune, no other remote, never a
  push, never a checked-out branch.
- **It never waits on a person.** `GIT_TERMINAL_PROMPT=0`, a 60 second timeout,
  and the user's own credentials (ssh agent, credential helper); Ork keeps none.
- **A failure stops the run** before any node, exit 1:
  `git fetch origin main failed: <git's line> (git.base is origin/main; set git.fetch: never to skip the fetch)`.
  A `user:token@` in a URL of that message is removed. The line is git's first
  `fatal:` line, because the last line of stderr is advice for a missing remote.
- **Not on a resume, a call that passes `baseRef`, or a run root handed a
  base:** they use the recorded or given commit. Every run with worktrees
  records its head as `settings.baseRef`; a resume prefers it (then `baseRef`
  given, over `git.base`), so it starts from the commit the run began on and
  never fetches.
- **`fetch: never`** fetches nothing; the base is what the clone last fetched. A
  `base` that is not a commit still stops the run, saying so.

## Reading at the base

`readonly: base` gives a `readonly` node with no owner and no upstream worktree
one shared worktree at the base commit instead of the project checkout, which
may be on another branch. Default `checkout`: nothing changes.
[Where it works and when it does not apply](../worktrees.md#a-readonly-node-at-the-base).
