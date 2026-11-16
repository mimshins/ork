# RFC-021 — `ork:security-audit` in attached projects

- **Status:** Draft
- **Date:** 2026-11-16
- **Supersedes:** —
- **Superseded by:** —

## Context

`ork:security-audit` is a built-in bundle
([ADR-096](../../decisions/ADR-096-built-in-bundles.md)): the workflow plus
companion files (the vendored skill, a read-only rule, the `tools/audit`
scripts), written under the project's Ork folder at `.ork/runs/.builtin/<hash>/`
and named by relative path in the prompts.

In a project attached with `ork register`, Ork's folder is
`~/.ork/projects/<id>/`
([ADR-035](../../decisions/ADR-035-projects-in-repo-or-attached.md),
`packages/core/src/project/place.ts`), so the bundle lands in
`~/.ork/projects/<id>/runs/.builtin/<hash>/`, outside the checkout. The audit's
agents are all `isolation: readonly` with no owner, so they work in the project
root and carry no `tools.allow` for a path elsewhere
(`packages/core/workflows/security-audit.ork.yaml`). The three drivers keep a
session inside its working folder:

- OpenCode asks `external_directory` for any path outside the worktree and Ork
  denies it (`packages/runtime/src/adapters/open-code-config.ts`,
  `PATH_ACTIONS`).
- Command Code's mod blocks a call that reaches outside the checkout unless a
  rule allows it (`command-code-mod.ts`).
- Claude Code asks, and a run waits for an answer (G29).

So the agents cannot read the skill or the rule. `scan`, the first node and
free, refuses before any agent starts: `bundleOutsideRoot` and
`OUTSIDE_ROOT_MESSAGE` in `tools/audit/scan.ts`. The register records it as
[L388](../../specs/gaps/audit-limits.md) and ADR-096 item 6 ruled out, for now,
a read grant and writing the bundle into the repository.

The refusal says to use `ork init`, but `ork init` refuses an attached project
too (`initRecorded` in `packages/cli/src/project/init.ts`). The route that works
today is `ork migrate`, which moves the attached folder into `.ork/` and records
the project in-repo ([projects](../../specs/projects.md#migrating)). That
message is wrong whatever this RFC decides; it is listed under Consequences.

The `tool.shell` nodes (`scan`, `ledger`, `consolidate`, `finalize`) run
`node <bundle>/security-audit/cli.ts` from the project root; a tool node is not
held to the checkout, so only the **agents'** reads are at issue. Reports
already go to `~/.ork/audits/<project>/<run-id>/`, outside any checkout.

## Options

### Option A — A read grant for the bundle folder

A session spec carries an extra read-only path; each driver adapter turns it
into its own rule.

- **Pros:** the audit runs where the project is, on the working tree with
  uncommitted changes, as it does in-repo; nothing is copied or written into the
  repository; one mechanism that a later built-in with companion files reuses.
- **Cons:** a runtime port change (`SessionSpec`) and three adapter changes,
  each with its own tests and an ADR; the grant is only as narrow as each driver
  can make it. If a driver cannot express a single path, the grant widens to a
  folder tree (the class of G14 and [L399](../../specs/gaps/onboard-limits.md):
  a bare allow reaches `~/.ssh` and `~/.aws`, and what an agent reads goes to
  the model provider). The read-only agents are the ones an injected repository
  file would steer, so a wider read is the wrong direction for them. Not
  checked: whether Claude Code and Command Code can grant one extra folder
  without a bare `Read`.

### Option B — A place inside the checkout that git ignores

`scan` (or the bundle writer) puts the bundle at a path inside the repository
that is excluded locally, for example `.git/info/exclude`, not `.gitignore`.

- **Pros:** no runtime change; agents read it as they read any file.
- **Cons:** it reopens ADR-096 item 6 and breaks ADR-035's promise that an
  attached project leaves the repository untouched: Ork would write 350 KB of
  files into the user's working tree and edit `.git/info/exclude`, in a project
  the user attached to avoid exactly that. A crash leaves the files behind. The
  audit's own agents and a second tool the user runs (an editor, a search) see
  the bundle as project content, and the bundle's skill text sits among the
  files the audit is told to treat as untrusted data.

### Option C — A per-run copy of only the needed files into a worktree

Ork makes the audit's agents work in a worktree it created for the run (beside
the clone, as for any worktree node, [worktrees](../../specs/worktrees.md)),
copies into it only what the agents read (the phase docs, the report schema, the
read-only rule; not the scripts, which run from the bundle folder), and removes
it when the run ends.

- **Pros:** no new grant and no runtime port change: the agents read inside
  their own folder, which is how all three drivers already behave; the user's
  working tree is not written to; the copy is a few files, not the 350 KB
  bundle.
- **Cons:** a worktree branches from `HEAD`, so an attached audit sees committed
  code, not uncommitted changes (the in-repo audit sees the working tree); the
  difference needs saying in the report and the guide. Readonly agents follow an
  owner's worktree (`worktrees.md`, "Where each node works"), so something must
  own one: whether a tool node or an agent can, and how `forEach` hunters and
  the resume path find it, is **not checked** and needs a spike. It is more
  engine surface than A or B.

## Decision

_Proposed, not decided._ Recommend **Option C**, if the spike shows a readonly
chain can follow a worktree Ork makes for the run; otherwise **Option A**,
narrowed to a single folder per driver, with its ADR.

Reasoning: C is the only option that widens neither what an agent can read nor
what Ork writes into the user's repository (the class G14 and L399 describe). A
trades that for a port change; B breaks the one promise attached projects make.
The cost of C, auditing `HEAD`, is the smaller harm, and the report can name the
commit it audited.

What each option lets an agent reach outside the checkout:

| Option | An agent can read outside the checkout                                      | An agent or Ork writes outside the checkout                       |
| ------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A      | the bundle folder, if each driver can grant one path; wider where it cannot | nothing new                                                       |
| B      | nothing new                                                                 | Ork writes into the repository and `.git/info/exclude`            |
| C      | nothing new                                                                 | Ork writes a worktree beside the clone, as any worktree node does |

## Consequences

- **Whichever option ships:** `tools/audit/scan.ts`'s refusal goes (A, C) or
  changes (B); [L388](../../specs/gaps/audit-limits.md) closes;
  [built-in workflows](../../specs/cli/built-in-workflows.md) ("Inside the
  project only"), the
  [security audit guide](../../docs/guides/security-audit.md) ("Limits") and
  ADR-096 item 6 change. A new ADR supersedes item 6 (A, B) or records C. Tests
  need an attached project fixture.
- **Now, with no decision:** the refusal text and the guide say `ork init`,
  which an attached project cannot use; they should say `ork migrate`. That is a
  one-line fix that this RFC does not wait for.
- **A:** `SessionSpec` and the three adapters change; the runtime port spec
  changes with them.
- **C:** the report records the audited commit; an uncommitted-changes warning
  as in [L400](../../specs/gaps/onboard-limits.md) is needed.

## Open questions

1. Can a readonly node chain, including `forEach` hunters and a resume, follow a
   worktree made for the run? (Needed for C.)
2. Can Claude Code, OpenCode and Command Code each grant one extra read-only
   folder without a broad rule? (Needed for A.)
3. Is auditing `HEAD` acceptable for an attached project, or must the audit see
   uncommitted changes?
4. Should the `ork init` advice be fixed first, as its own change?
