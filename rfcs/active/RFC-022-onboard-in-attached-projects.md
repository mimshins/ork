# RFC-022 — `ork onboard` in attached projects

- **Status:** Draft
- **Date:** 2026-11-16
- **Supersedes:** —
- **Superseded by:** —

## Context

`ork onboard` ([RFC-018](../archived/RFC-018-onboard.md),
[ADR-097](../../decisions/ADR-097-onboarding-workflows.md)) reads a repository,
asks questions, proposes workflows and has a writer node put the picked ones in
`.ork/workflows/` on a branch, in its own worktree. Ork never merges the branch;
the person keeps or discards it at a gate.

A project attached with `ork register` keeps Ork's files in
`~/.ork/projects/<id>/` and nothing in the repository
([ADR-035](../../decisions/ADR-035-projects-in-repo-or-attached.md),
`packages/core/src/project/place.ts`). The command refuses it: `refusal` in
`packages/cli/src/onboard/refusals.ts` returns "… is attached, and ork onboard
writes into a repository: run `ork init` …"
([L390](../../specs/gaps/onboard-limits.md)). What the feature rests on, and
what an attached project lacks:

- **The writer's target is a path in a git worktree.** `ork:onboard-write`'s
  `finish` step checks the worktree's change against `.ork/workflows/*.ork.yaml`
  and `.ork/project.yaml` and commits it to the branch
  (`packages/cli/src/onboard/finish-git.ts`). An attached project's workflows
  live in `~/.ork/projects/<id>/workflows/`, which is not in any worktree of the
  repository.
- **The writer reads the repository.** It works in a worktree of the project, so
  it can read source and `package.json` inside its own folder. The same writer
  has `Edit` and `Write` allowed by bare name, which on `claude-code` and
  `command-code` is not held to the worktree (G14,
  [L395](../../specs/gaps/onboard-limits.md)), and OpenCode refuses a path
  outside its worktree (`open-code-config.ts`).
- **Attached workflows read the repository as if they were in
  `<root>/.ork/workflows/`** (`workflowDirOf`), and `ork migrate` moves an
  attached folder into `.ork/` unchanged
  ([projects](../../specs/projects.md#migrating)). So a workflow written for an
  attached project is the same text as an in-repo one.
- **The advice in the refusal does not work.** `ork init` refuses an attached
  project too (`initRecorded`, `packages/cli/src/project/init.ts`: "Ork writes
  nothing into its repository"). The route that exists is `ork migrate`, which
  puts `.ork/` in the repository and leaves the change uncommitted.
- **State is ruled out.** The plan around this RFC rules out a state file or new
  store event for onboard; an option that needs a baseline must say where it
  lives.

## Options

### Option A — Write into the attached folder, diff against a recorded baseline

The writer's cwd is the attached folder, or Ork copies the writer's output
there; before the paid run Ork records what the folder held (a copy of
`workflows/` and `project.yaml`), and the gate shows the diff against that copy.
Discard restores the copy.

- **Pros:** matches what attached means: no branch, no repository change; the
  result is live right away.
- **Cons:** the writer would write outside its worktree, which needs a write
  grant for one folder per driver (a runtime port change, the class of G14: a
  bare `Edit` already reaches any path on two drivers, and OpenCode refuses
  until a grant exists). The baseline is a new place Ork keeps state. There is
  no branch to keep, so "Ork never merges" has no meaning: the live workflows
  change before the person decides, and a crash between write and gate leaves
  them changed with no baseline to find. `finish`'s checks use `git diff` and
  `--ignored` on the worktree; they would need a second implementation over
  plain folders.

### Option B — A scratch git repository in Ork's folder, with a copy-back

Ork makes a git repository inside `~/.ork/projects/<id>/` holding the attached
files, runs the writer in a worktree of it, shows the branch and diff as today,
and on keep copies the result back into the attached folder.

- **Pros:** the writer, `finish`, the gate and the keep and discard rules are
  the ones that exist; the branch and diff are real git; a discard is a branch
  delete.
- **Cons:** the writer's worktree has none of the project's source, so it cannot
  check that `pnpm test` or a path the pick names exists. Either it works from
  the survey text alone (a worse writer) or it is granted reads of the real
  repository outside its cwd (the class of
  [L399](../../specs/gaps/onboard-limits.md)). The engine's worktree manager is
  per project root (`packages/core/src/worktree/manager.ts`), so a run in a
  scratch repository is new engine work. A second repository per project, and a
  copy-back that is itself a write into live files, add surface.

### Option C — Keep refusing, and tell the person the real way

No code beyond the message: the refusal names `ork migrate`, then `ork onboard`,
instead of `ork init`, and the onboarding guide says so.

- **Pros:** nothing new to secure; no runtime or engine change; fixes a message
  that sends people to a command that also refuses.
- **Cons:** the person who attached on purpose, to keep the repository
  untouched, must give that up (`ork migrate` writes `.ork/` into the
  repository, uncommitted) before onboarding, and may decline.

### Option D — Seed the real repository's worktree, copy back on keep

Not in the brief; it falls out of the facts above. Ork makes the writer's
worktree as it does today, copies the attached `workflows/` and `project.yaml`
into the worktree's `.ork/`, runs `finish` unchanged, and on keep copies the
checked `.ork/workflows` and `project.yaml` into the attached folder. Under
`commit: never` ([project rules](../../specs/project-rules.md)) a worktree is
detached and its work is handed over as a patch, so no branch needs to exist in
the repository.

- **Pros:** the writer reads the real source inside its own folder, so no new
  read or write grant; `finish`, the gate and the diff are unchanged; the repo
  gets no `.ork/` and no branch.
- **Cons:** the copy-in and copy-back are new steps; the attached files must not
  be stale between copy-in and keep (a change in the meantime is overwritten
  unless compared); it still adds a worktree and its git metadata in the
  repository's `.git`, which any run of an attached project already does; the
  worktree base is `HEAD`, so uncommitted files are not seen (the same as
  [L400](../../specs/gaps/onboard-limits.md)).

## Decision

_Proposed, not decided._ Recommend **Option C now**, and **Option D** if
attached users want onboarding: it is the only one of the three building options
that gives the writer the repository to read with no new read or write grant
outside the checkout. A needs the grant and a baseline; B loses the writer's
reads or needs the same grant.

What each option lets an agent reach outside the checkout:

| Option | An agent can read outside the checkout             | An agent or Ork writes outside the checkout                                                                                        |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A      | nothing new                                        | the writer writes the attached folder: a per-driver write grant, and a bare `Edit` already reaches everywhere on two drivers (G14) |
| B      | the real repository, or nothing and a blind writer | Ork copies back into the attached folder; the writer stays in the scratch worktree                                                 |
| C      | nothing new                                        | nothing new; the person runs `ork migrate`                                                                                         |
| D      | nothing new                                        | Ork (not the agent) copies into and out of the attached folder; the writer stays in its worktree                                   |

In every option the bare `Edit` and `Write` allows stay as G14 and L395 say: a
check on the worktree, not a sandbox.

## Consequences

- **Whichever option:** the refusal text and
  [the onboarding guide](../../docs/guides/onboarding.md) stop saying
  `ork init`; they name `ork migrate`. That is a one-line fix that does not wait
  for this RFC.
- **C:** [L390](../../specs/gaps/onboard-limits.md) stays open and its text
  names `ork migrate`.
- **A, B or D:** `refusal` loses the attached branch; `prepare` in
  `packages/cli/src/onboard/setup.ts` must not call `initRecorded` for an
  attached project; the writer's rule (`writing.md`) and `finish` name the
  attached folder; specs [onboard-flow](../../specs/cli/onboard-flow.md) and
  [onboard-verbs](../../specs/cli/onboard-verbs.md), the gaps and an ADR change.
  A and B also need a runtime port or engine change, so each has its own ADR.
- **A and B:** a new place for state (baseline, scratch repository).

## Open questions

1. Do attached users want `ork onboard`, or is `ork migrate` first acceptable to
   them? (Decides C against D.)
2. D: what if the attached folder changes between copy-in and keep: refuse,
   compare, or overwrite?
3. D: is a detached worktree under `commit: never` available to the writer
   without changing `ork:onboard-write`'s `finish` branch handling? Not checked.
4. Should the `ork init` advice in the refusal be fixed first, as its own
   change?
