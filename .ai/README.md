# .ai — agent knowledge layer

Map of the AI-oriented layer of this repository. It **references** the project's
own knowledge (`docs/`, `README.md`, `AGENTS.md`, the code and its config) and
never duplicates it. If all AI tooling were removed, those sources would still
stand on their own.

Entry point for agents: [`AGENTS.md`](../AGENTS.md). Tool adapters (`CLAUDE.md`,
`.claude/skills`) are pointers into this layer or into `docs/`.

**Public repository:** everything here is world-readable. No secrets, internal
hostnames, dashboard links, or personal data, in memories included.

## Placement rules

| Location        | Holds                                      | Test question                                                        |
| --------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| `docs/`         | design, behavior, the interaction map      | Is this what the system is or is supposed to do?                     |
| `.ai/memories/` | durable context that helps an agent orient | Does it help an agent decide, without being a contract or procedure? |

**Precedence** when sources disagree: explicit developer instructions >
code/config > `docs/` > memories > agent assumptions. Fix or flag the lower
source and mention it in your report.

**Rules:** single source of truth — link, don't copy; memories describe the
present, not history.

## Index

Load only what the task needs.

- [`memories/development-workflow.md`](./memories/development-workflow.md) —
  commits, pull requests, attribution, and the local quality gate. Before
  committing or opening a pull request.
