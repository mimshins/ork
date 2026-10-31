# ADR-020 — Worktrees beside the clone, with the local layer and committed instructions

- **Status:** Accepted; amended by [ADR-032](./ADR-032-project-rules.md)
- **Date:** 2026-10-30
- **Topic:** engine / worktrees
- **RFC:** waived — the author chose among the options below directly
- **Supersedes:** [ADR-009](./ADR-009-worktree-per-writing-node.md)

## Context

ADR-009 gave each writing node a git worktree under `.ork/worktrees/` and
removed them all when the run ended. Building it against a real repository
(se-backend) showed four problems:

- Claude Code loads `CLAUDE.md` and `CLAUDE.local.md` from the working directory
  **and every parent**, so a worktree inside the clone loads the main checkout's
  instructions on top of the branch's own.
- Repositories have their own worktree conventions: se-backend keeps worktrees
  beside the clone (`../<clone>-worktrees/`) and tells agents to create one per
  task.
- A worktree is a fresh checkout: gitignored files such as `CLAUDE.local.md`,
  `.claude/settings.local.json` and `.env` are missing.
- Instructions and skills live in the repository (often symlinked, like
  `.claude/skills -> ../.ai/skills`), so uncommitted edits to them are invisible
  in a worktree.

## Decision

1. **Isolation modes** stay as ADR-009 set them: `worktree` (default), `shared`,
   `readonly`.
2. **Worktrees live beside the clone**, `../<clone>-worktrees/ork-<run>-<node>`,
   on branch `ork/<run>/<node>`, and the session is told not to create another.
3. **The local layer comes along**: gitignored `CLAUDE.local.md` and
   `.claude/settings.local.json`, plus what `.worktreeinclude` lists.
4. **Uncommitted instructions, skills or agents stop the run** unless
   `--allow-dirty`.
5. **Cleanup:** merged children's worktrees are removed; root and unmerged ones
   stay and are listed. Branches always stay. `ork worktrees` lists and cleans
   them.

Detail: [specs/worktrees.md](../specs/worktrees.md).

## Options considered

- **Inside the clone** (`.ork/worktrees/`, ADR-009): self-contained, but every
  session also loads the main checkout's instructions.
- **Beside the clone** — chosen.
- **Local files:** copy nothing; copy only `.worktreeinclude`; copy the local
  agent files plus `.worktreeinclude` — chosen.
- **Uncommitted agent files:** warn and continue; copy them in (they would end
  up committed on the node's branch); refuse unless `--allow-dirty` — chosen.
- **Cleanup:** remove all; keep all (se-backend's "only a human cleans up");
  remove merged children and keep roots — chosen, with `ork worktrees clean` for
  the rest.

## Rationale

Beside the clone, each session loads exactly one set of instructions, from its
own branch, and Ork matches the convention repositories already use. Copying the
local layer makes a worktree run behave like an in-place one. Refusing on dirty
instructions avoids a run that silently follows other rules than the user can
see. Keeping the run's result for inspection, and offering a safe, explicit
clean command, respects repositories where cleanup is a human decision.

## Consequences

- Ork writes outside the project directory, but only in
  `../<clone>-worktrees/ork-*`.
- `ork init` no longer adds `.ork/worktrees/` to `.gitignore`.
- `.worktreeinclude` can copy secrets such as `.env` into worktrees; that is the
  repository's explicit choice, as in Claude Code.
