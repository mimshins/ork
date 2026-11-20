# ADR-099 — `ork onboard` keeps refusing attached projects, and names `ork migrate`

- **Status:** Superseded by [ADR-114](./ADR-114-onboard-in-attached-projects.md)
- **Date:** 2026-11-17
- **Topic:** `ork onboard`, projects
- **RFC:** [RFC-022](../rfcs/archived/RFC-022-onboard-in-attached-projects.md)
  (option C; option D kept for later)

## Context

`ork onboard` ([ADR-097](./ADR-097-onboarding-workflows.md)) has a writer put
the picked workflows in `.ork/workflows/` on a branch, in its own worktree, and
the person keeps or discards the branch at a gate. A project attached with
`ork register` keeps Ork's files in `~/.ork/projects/<id>/` and nothing in the
repository ([ADR-035](./ADR-035-projects-in-repo-or-attached.md)), so there is
no path in a worktree for the writer to write. The command refused such a
project and told the person to run `ork init`, which refuses an attached project
too. `ork migrate` is the route that works: it moves the attached folder into
the repository's `.ork/` and records the project in-repo.

## Decision

`ork onboard` keeps refusing an attached project, before anything is written or
spent, and its refusal names `ork migrate`, then `ork onboard`
(`packages/cli/src/onboard/refusals.ts`,
[onboard flow](../specs/cli/onboard-flow.md)). The onboarding guide says the
same. Attached support stays open as [L390](../specs/gaps/onboard-limits.md).

`ork:security-audit`'s `scan` refusal for an attached project, which also named
`ork init`, names `ork migrate` in the same change (`tools/audit/scan.ts`); how
the audit will support attached projects is
[RFC-021](../rfcs/archived/RFC-021-audit-in-attached-projects.md).

## Options considered

From RFC-022:

- **A — write into the attached folder, diff against a recorded baseline:**
  needs a per-driver write grant outside the worktree (the class of G14), a new
  place for state, and changes the live workflows before the person decides.
- **B — a scratch git repository in Ork's folder, copied back on keep:** the
  writer loses the project's source, or needs a read grant for it, and the
  engine's worktree manager is per project root.
- **C — keep refusing and name the real route (chosen).**
- **D — seed the real repository's worktree with the attached files, run
  `finish` unchanged, copy the result back on keep:** no new read or write
  grant; kept for when attached users ask for onboarding.

## Rationale

C adds nothing to secure and fixes a refusal that sent people to a command that
also refuses. Whether attached users want onboarding at all is not known; D is
the building option to take if they do, since it needs no grant outside the
checkout, unlike A and B.

## Consequences

- An attached user who wants onboarding gives up the untouched repository:
  `ork migrate` writes `.ork/` into it, uncommitted.
- If attached users ask, D is built under its own plan; its open questions (the
  attached folder changing between copy-in and keep, a detached worktree under
  `commit: never` for the writer) are in RFC-022.
