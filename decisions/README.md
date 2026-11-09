# Decisions (ADRs)

Architecture Decision Records: accepted, durable decisions and why they were
made. They are project knowledge and stand on their own without any AI tooling.

## Conventions

- **Location:** `decisions/`
- **Naming:** `ADR-NNN-<kebab-case-title>.md`; the next free number, never
  reused.
- **Sections:** Context, Decision, Options considered, Rationale, Consequences.
  Metadata: Status, Date, Topic, RFC (or "waived" with the reason).
- **Self-contained:** a reader with only the ADR understands the decision and
  why. Link to [specs](../specs/README.md) and code for detail; do not restate
  them.
- **Immutable once accepted:** a later decision supersedes an ADR with a new
  ADR; the old one only gains `Status: Superseded by ADR-NNN`.
- **Amended, not superseded:** a later ADR that changes part of one says
  `Amends: ADR-NNN` in its metadata, and the old one only gains
  `Status: Accepted; amended by ADR-NNN`. The index reads `Amended by NNN`.
- **Atomic:** one decision per file. A long ADR gets a `## Contents` list, never
  a chunk folder ([docs structure](../runbook/development/docs.md)).

## When to write one

- An RFC ships: record its decision here and link both ways.
- A hard-to-reverse choice is made without an RFC: a new runtime dependency, a
  change to the workflow file format, a change to a layer rule or the dependency
  direction, a change to how Ork touches credentials or publishes.

Current and specified behavior belongs in [`specs/`](../specs/README.md);
proposals belong in [`rfcs/`](../rfcs/README.md).

## Index

| ADR                                                  | Title                                                                               | Status              | RFC                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| [001](./ADR-001-spec-driven-development.md)          | Spec-driven development and the knowledge layout                                    | Accepted            | waived                                                                  |
| [002](./ADR-002-typescript-from-source.md)           | A TypeScript monorepo run from source, with supply-chain policies                   | Accepted            | waived                                                                  |
| [003](./ADR-003-oxlint-oxfmt-and-boundaries.md)      | oxlint and oxfmt, with package boundaries enforced by lint                          | Accepted            | waived                                                                  |
| [004](./ADR-004-no-credentials.md)                   | Ork never handles credentials                                                       | Accepted            | waived                                                                  |
| [005](./ADR-005-one-runtime-port-two-drivers.md)     | One runtime port, two Claude drivers                                                | Amended by 064, 065 | waived                                                                  |
| [006](./ADR-006-workflow-file-format.md)             | The workflow file format                                                            | Accepted            | waived                                                                  |
| [007](./ADR-007-safe-expression-language.md)         | A safe expression language for conditions and templates                             | Accepted            | waived                                                                  |
| [008](./ADR-008-ownership-hierarchy.md)              | Ownership hierarchy rules                                                           | Accepted            | waived                                                                  |
| [009](./ADR-009-worktree-per-writing-node.md)        | A git worktree per writing node                                                     | Superseded by 020   | waived                                                                  |
| [010](./ADR-010-reports-as-structured-output.md)     | Node reports as structured output                                                   | Accepted            | waived                                                                  |
| [011](./ADR-011-in-house-mcp-server.md)              | A minimal in-house MCP server for the CLI driver                                    | Accepted            | waived                                                                  |
| [012](./ADR-012-no-ai-attribution.md)                | No AI or agent attribution                                                          | Accepted            | waived                                                                  |
| [013](./ADR-013-feedback-loop.md)                    | The feedback loop                                                                   | Amended by 059      | waived                                                                  |
| [014](./ADR-014-interaction-map.md)                  | The interaction map as the onboarding and audit view                                | Accepted            | waived                                                                  |
| [015](./ADR-015-changesets-and-one-bundled-cli.md)   | Releases with changesets and one bundled CLI                                        | Accepted            | waived                                                                  |
| [016](./ADR-016-scheduler-semantics.md)              | How a workflow runs: activations, edges, dead paths and loops                       | Accepted            | waived                                                                  |
| [017](./ADR-017-blocking-delegate.md)                | Leaders delegate with a blocking tool call                                          | Accepted            | waived                                                                  |
| [018](./ADR-018-ork-merges-children.md)              | Ork merges a passing child's branch into its owner's                                | Accepted            | waived                                                                  |
| [019](./ADR-019-leaders-resume-on-reentry.md)        | On a loop re-entry, leaders resume and workers start fresh                          | Amended by 033      | waived                                                                  |
| [020](./ADR-020-worktrees-beside-the-clone.md)       | Worktrees beside the clone, with the local layer and committed instructions         | Amended by 032      | waived                                                                  |
| [021](./ADR-021-built-in-practices.md)               | Built-in practices: caveman and ponytail, on by default                             | Accepted            | waived                                                                  |
| [022](./ADR-022-integration-registry.md)             | Integrations as adapters behind registries                                          | Accepted            | [RFC-001](../rfcs/archived/RFC-001-integrations-as-adapters.md)         |
| [023](./ADR-023-context-compiler.md)                 | How the context compiler hands layers to Claude Code                                | Accepted            | waived                                                                  |
| [024](./ADR-024-event-store.md)                      | Runs are recorded in one SQLite store, with a JSONL copy                            | Accepted            | waived                                                                  |
| [025](./ADR-025-message-bus.md)                      | Nodes message each other with a notice, then a pull                                 | Amended by 044      | waived                                                                  |
| [026](./ADR-026-resume-by-replay.md)                 | `ork resume` replays a run's recorded results                                       | Accepted            | waived                                                                  |
| [027](./ADR-027-advisory-claims.md)                  | Claims are advisory, by path, and released when a node ends                         | Accepted            | none                                                                    |
| [028](./ADR-028-feedback-capture.md)                 | Feedback is captured beside the run's events, grouped by item                       | Accepted            | none                                                                    |
| [029](./ADR-029-readonly-follows-its-input.md)       | A readonly node with no owner works where its input came from                       | Accepted            | waived                                                                  |
| [030](./ADR-030-agents-fill-nodes.md)                | Agents are defined once and fill nodes                                              | Accepted            | waived                                                                  |
| [031](./ADR-031-ork-is-the-origin.md)                | `.ork/` is the origin; tool folders link to it                                      | Accepted            | waived                                                                  |
| [032](./ADR-032-project-rules.md)                    | Project rules: what Ork does on its own is the project's choice                     | Accepted            | waived                                                                  |
| [033](./ADR-033-session-resume-on-any-node.md)       | Any Claude node can resume its session on re-entry                                  | Accepted            | waived                                                                  |
| [034](./ADR-034-tool-git.md)                         | `tool.git`: a commit is an explicit step                                            | Accepted            | waived                                                                  |
| [035](./ADR-035-projects-in-repo-or-attached.md)     | A project's files live in its repository or beside it, attached                     | Accepted            | waived                                                                  |
| [036](./ADR-036-ork-migrate.md)                      | `ork migrate`: move into the repository, never commit                               | Accepted            | waived                                                                  |
| [037](./ADR-037-isolation-continue.md)               | `isolation: continue`: write in the worktree your input came from                   | Accepted            | waived                                                                  |
| [038](./ADR-038-update-notice-and-upgrade.md)        | A daily new-version notice, and `ork upgrade` that asks first                       | Amended by 061      | waived                                                                  |
| [039](./ADR-039-local-server.md)                     | A local server that is one more client of the store, on `node:http`                 | Accepted            | waived                                                                  |
| [040](./ADR-040-ui-stack.md)                         | The UI's stack: React, Base UI, dockview, containerized-state, our graph            | Accepted            | waived                                                                  |
| [041](./ADR-041-pause-continue-stop.md)              | Pause holds a session before its next tool call; stopping a node fails it           | Accepted            | waived                                                                  |
| [042](./ADR-042-icons-mdi.md)                        | The UI's icons come from Material Design Icons                                      | Accepted            | waived                                                                  |
| [043](./ADR-043-timeouts.md)                         | Timeouts measure work, and an expired node is an ordinary failure                   | Accepted            | waived                                                                  |
| [044](./ADR-044-relay-between-runs.md)               | Nodes of different runs message each other over a relay in the store                | Accepted            | [RFC-003](../rfcs/archived/RFC-003-relay-between-runs.md)               |
| [045](./ADR-045-workflows-calling-workflows.md)      | A workflow calls another as its own run, through a node                             | Accepted            | [RFC-004](../rfcs/archived/RFC-004-workflows-calling-workflows.md)      |
| [046](./ADR-046-usage-ledger-and-prune.md)           | A usage ledger beside the events, and pruning by hand                               | Accepted            | none                                                                    |
| [047](./ADR-047-script-identity-env-json.md)         | Tool nodes know who they are, take an environment, and return JSON                  | Accepted            | waived                                                                  |
| [048](./ADR-048-scripts-and-rules-on-the-bus.md)     | Scripts and rules post to the message bus                                           | Accepted            | [RFC-005](../rfcs/archived/RFC-005-scripts-and-rules-on-the-bus.md)     |
| [049](./ADR-049-steps-mcp-calls-and-scripts.md)      | Deterministic steps around a session, MCP calls and inline scripts                  | Accepted            | [RFC-006](../rfcs/archived/RFC-006-steps-around-a-session.md)           |
| [050](./ADR-050-limits-across-runs.md)               | Limits across runs                                                                  | Accepted            | [RFC-007](../rfcs/archived/RFC-007-limits-across-runs.md)               |
| [051](./ADR-051-workflow-builder.md)                 | A workflow builder that keeps the YAML                                              | Accepted            | [RFC-008](../rfcs/archived/RFC-008-workflow-builder.md)                 |
| [052](./ADR-052-conditions-from-declared-outputs.md) | Conditions chosen from what a node declares it can say                              | Accepted            | [RFC-010](../rfcs/archived/RFC-010-conditions-from-declared-outputs.md) |
| [053](./ADR-053-watching-a-source.md)                | Watching a source, inside a run and to start one                                    | Accepted            | [RFC-011](../rfcs/archived/RFC-011-watching-a-source.md)                |
| [054](./ADR-054-component-tokens.md)                 | Each component owns its tokens, and a state only sets tokens                        | Accepted            | waived                                                                  |
| [055](./ADR-055-console-language.md)                 | The console's language: frames, cards and two voices                                | Accepted            | waived                                                                  |
| [056](./ADR-056-walking-a-workflow.md)               | Walking every way through a workflow before it runs                                 | Accepted            | [RFC-009](../rfcs/archived/RFC-009-walking-a-workflow.md)               |
| [057](./ADR-057-ork-for-claude-code.md)              | Teaching Claude Code Ork's standards: `ork mcp`, skills and a plugin                | Amended by 058      | [RFC-012](../rfcs/archived/RFC-012-teaching-claude-code-ork.md)         |
| [058](./ADR-058-plugin-expects-oldest-ork.md)        | The plugin expects the oldest Ork it works with                                     | Accepted            | waived                                                                  |
| [059](./ADR-059-closing-the-feedback-loop.md)        | Closing the feedback loop: built-in workflows, rule-based triage, previews          | Accepted            | waived                                                                  |
| [060](./ADR-060-ork-ui-supervises-its-server.md)     | `ork ui` supervises its server, so the page can restart it onto a new install       | Accepted            | waived                                                                  |
| [061](./ADR-061-release-channels-toward-1-0.md)      | Release channels toward 1.0.0: alpha, beta and rc on `latest` too; canary apart     | Accepted            | waived                                                                  |
| [062](./ADR-062-notes-on-decision-answers.md)        | An answer may carry a note: a gate outputs it, `ork decide --say` gives it          | Accepted            | waived                                                                  |
| [063](./ADR-063-leader-questions.md)                 | A child's question can go to its leader first: a fork of its session answers        | Accepted            | waived                                                                  |
| [064](./ADR-064-driver-chosen-at-run-time.md)        | The Claude driver is chosen when a run starts, from the one ready if none is named  | Accepted            | waived                                                                  |
| [065](./ADR-065-clean-claude-sessions.md)            | Claude sessions start clean of the machine's setup; `--machine-claude` opts back in | Accepted            | waived                                                                  |
| [066](./ADR-066-experiments-registry.md)             | Experiments: one registry, an explicit opt-in, off by default                       | Accepted            | waived                                                                  |
| [067](./ADR-067-nodes-name-mcp-servers.md)           | A node names the MCP servers it needs, from the project's `.mcp.json`               | Accepted            | waived                                                                  |
| [068](./ADR-068-gate-document-and-readable-text.md)  | A gate's document, and decision text a person can read                              | Accepted            | waived                                                                  |
| [069](./ADR-069-markdown-view-parser.md)             | Decision text is drawn from a Markdown tree, by Ork's own renderer                  | Accepted            | waived                                                                  |
| [070](./ADR-070-for-each-field-group.md)             | Run a node once per item with a `forEach` field group                               | Accepted            | [RFC-013](../rfcs/active/RFC-013-for-each.md)                           |
| [071](./ADR-071-workflows-by-stage.md)               | Ork's own process as staged workflows that ask the maintainer                       | Accepted            | waived                                                                  |
