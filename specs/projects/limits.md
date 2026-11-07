# Limits: projects, git and installs

_Part of [Projects: in the repository, or attached](../projects.md)._

How [projects](../projects.md), their [rules](../project-rules.md) and Ork's own
install work for now, by choice. Those the gaps review carried are open work in
the [register](../gaps.md#limits).

- **L7 · A shadowed project skill hides its alias.** Switching off a project
  skill named `review` also hides Claude Code's `/code-review`.
  ([ADR-023](../../decisions/ADR-023-context-compiler.md))
- **L8 · Integrations ship with Ork.** A new CLI integration needs an Ork
  release; there are no declared or third-party integrations.
  ([ADR-022](../../decisions/ADR-022-integration-registry.md))
- **L9 · Windows only through WSL.** Native Windows is untested.
  ([installation](../../docs/getting-started/installation.md))
- **L13 · Tool folders are linked with symlinks.** On native Windows, git checks
  links out as plain files unless `core.symlinks` is on (developer mode); there
  is no junction or copy fallback.
  ([ADR-031](../../decisions/ADR-031-ork-is-the-origin.md))
- **L14 · Project permissions are `allow` and `deny` only.** Claude Code's `ask`
  list (prompt before a tool) is left to the project's own
  `.claude/settings.json`, which a node loads.
  ([project rules](../project-rules.md))
- **L15 · A patch applies whole or not at all.** Under `merge: patch`, a child
  whose changes do not apply cleanly is kept with the conflicting files named;
  there is no three-way apply with conflict markers.
  ([ADR-032](../../decisions/ADR-032-project-rules.md))
- **L16 · `git.base` is not fetched.** A base such as `origin/main` is whatever
  the clone last fetched; Ork never fetches.
  ([project rules](../project-rules.md))
- **L17 · A `tool.git` commit under `commit: never` is on no branch.** The
  worktree is detached, so the workflow makes its own branch (`switch -c`,
  allowed on the node) or the commit stays on none; `ork worktrees clean` keeps
  such a worktree unless `--force`. Ork could make the root's branch from
  `git.branch` without committing.
  ([ADR-034](../../decisions/ADR-034-tool-git.md))
- **L18 · An allow list checks the subcommand, not its flags.**
  `allow: [commit]` also allows `commit --amend` or `commit --no-verify`; what
  follows the prefix is the workflow's.
  ([workflow format](../workflow-format.md))
- **L19 · An attached project's own folder holds only agents and lessons.** A
  skill or context file kept in `~/.ork/projects/<id>/` cannot be referenced: an
  attached workflow's paths resolve inside the repository.
  ([projects](../projects.md))
- **L22 · A migration is not atomic.** Its plan is checked before anything
  moves, but a move that fails halfway (a permission, a full disk) stops there;
  nothing is lost, and `ork migrate` again plans what is left.
  ([projects](../projects.md#migrating))
- **L23 · The update check reads no `.npmrc`.** It asks npm's registry, or
  `ORK_UPDATE_REGISTRY`; a mirror set only in npm's own config is not used.
  ([updates](../cli/updates.md))
- **L24 · `ork upgrade` knows an install by its path.** An install in a place it
  does not recognise gets the npm command as advice, and nothing is run.
  ([updates](../cli/updates.md#ork-upgrade))
