## What and why

<!-- One logical change. Link the issue it addresses. -->

## How it was verified

<!-- Commands run (e.g. `pnpm check`, `pnpm ork validate examples`, a manual run) and their results. -->

## Checklist

- [ ] `pnpm check` passes locally (format, lint, typecheck, tests).
- [ ] Tests cover the change; no test calls a real service or a real account.
- [ ] Package boundaries hold: dependency direction respected, other packages
      imported through their public entry point only.
- [ ] Workflow format changes: `workflow.schema.json` regenerated, examples
      still valid and canonical, docs updated.
- [ ] `docs/design.md` and the interaction map match the change.
- [ ] No credential is stored, logged, or written to events, artifacts, or
      workflow files; no new path for a workflow to run a shell or escape its
      directory.
- [ ] No new dependency, or it is justified above; exact version, at least 7
      days old, no lifecycle script; any new GitHub Action pinned by full commit
      SHA.
- [ ] **Public repository:** no secrets, tokens, account identifiers, internal
      hostnames, or personal data.
- [ ] No AI or agent attribution in commits or in this description.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the development flow.
