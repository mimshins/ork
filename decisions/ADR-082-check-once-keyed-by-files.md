# ADR-082 — A check runs once per set of files, and passes are kept in the git folder

- **Status:** Accepted
- **Date:** 2026-11-11
- **Topic:** CLI, workflow format, core, project rules
- **RFC:** waived — the maintainer decided this directly in discussion on
  2026-11-11 (plan "Check once")

## Context

Measured on a build run after the smooth-runs change
([ADR-080](./ADR-080-machine-slots-and-lower-priority.md)): about 1.6 CPU-hours
of checks, much of it on files already checked. The docs node ran a full check
though it edited nothing; the publish step ran one though the files had not
changed since the leader's; an agent's own passing `pnpm check:changed` was
followed by Ork's identical `verify:`; the pre-push hook checked again a tree a
run had just checked. A full check costs about 600 CPU-s on a loaded machine.

## Decision

- **A check is skipped when it already passed on identical files.**
  `ork once [--as <name>] [--covers <name>]… [--with-head] [--force] -- <command…>`
  runs the command unless a pass is on record, and records one when it exits 0
  and the files did not change while it ran. A failure records nothing.
- **The key is the files' content, not the commit.** A hash of the working
  tree's files (tracked and untracked, not ignored), made with `git add -A` and
  `git write-tree` on a temporary copy of the index so the real one is
  untouched; plus the check's name (`--as`, default the command's text) and
  Node's version. `--with-head` adds `HEAD`, for checks relative to it
  (`vitest --changed`). `--covers` records the same pass under other names, so a
  full check stands for a quicker one. A commit or a no-op rebase keeps a hit;
  the lockfile is in the key, `node_modules` and build output are not.
- **Passes are kept in `<git-common-dir>/ork-once/`.** One small JSON file per
  name, files and Node version: the tree, `HEAD`, the time and who ran it
  (`<run>/<node>` or `you`). The folder is shared by every worktree of the
  repository and is outside all of them, so a session's file edits never reach
  it. Passes older than 7 days, or past the newest 500, are pruned when one is
  written.
- **Workflows can ask for it.** `once: true` on a `verify:` and on a tool node
  (optional; no `schemaVersion` change) wraps the command the same way, and the
  run records a `verify.skipped` event naming the earlier pass. `--force` and
  `ORK_ONCE=off` run it anyway.
- **This repository wires it in its scripts.** `pnpm check` and
  `pnpm check:changed` go through `ork once`, so the pre-push hook, an agent's
  own run, `verify:` and the publish step share one cache. CI has no cache (a
  fresh checkout) and runs the scripts it names, so it always runs everything.

## Options considered

- **This repository's scripts only.** Other projects would not get it.
- **Changed-only checks in the leader's rounds.** A break would show only at
  publish, after the gates.
- **Key by commit.** A commit or a rebase that changes no file would re-run.
- **Passes in the repository's working tree or `~/.ork`.** The first is visible
  to sessions and editable; the second is shared across repositories and
  unrelated to the checkout.
- **No cache.** The same files are checked again and again.

## Rationale

The files are what a check reads, so identical files give the same answer, and a
hash of them is cheap (git hashes only the files whose stat changed). The git
common directory is per repository, shared by worktrees, never committed, and
outside what a session can edit. No new dependency: git is already required.

## Consequences

- A check that reads something outside the files (the network, a tool's version)
  can pass on one machine state and be skipped on another. Node's version is in
  the key; the rest is the project's choice of what to wrap, and `--force` is
  there. A node's `env:` values are not in the key
  ([L265](../specs/gaps/check-once-limits.md)).
- A skipped tool node has no `json` output
  ([L263](../specs/gaps/check-once-limits.md)).
- The event stream gains `verify.skipped`; older runs are unaffected.
- A pass holds a hash, a name, a time and who ran it; no secrets.
- The suite itself was also made cheaper in the same change (see
  [the check-once spec](../specs/check-once.md#a-cheaper-suite)).
