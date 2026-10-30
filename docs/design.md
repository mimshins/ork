# Ork design (v1)

Ork is a local "n8n for agents": you design workflows of agent and tool nodes,
serialize them to git-friendly files, and run them on your own machine from a
CLI (`ork`) or a localhost web UI (`ork ui`).

Nodes form an **ownership hierarchy**. A node owns its descendants, gives them
only the context they need, and gets summaries back. The goal is a harness that
builds in good practice: token saving, context engineering, bounded loops,
quality gates, a human in the loop, and full observability.

**Credentials.** Ork never stores, proxies, or asks for credentials: every
integration uses the user's own login, and the Agent SDK driver runs only with
an API key or a cloud provider
([ADR-004](../decisions/ADR-004-no-credentials.md)).

This page is the overview. The contracts are the [specs](../specs/README.md);
the decisions and their reasons are the [ADRs](../decisions/README.md); how the
parts fit together is the [interaction map](./interaction-map/README.md).

## Where to read

| Topic                                    | Spec                                                |
| ---------------------------------------- | --------------------------------------------------- |
| Vocabulary: nodes, owners, edges, runs   | [Core concepts](../specs/concepts.md)               |
| Packages and dependency direction        | [Architecture](../specs/architecture.md)            |
| The `.ork.yaml` format                   | [Workflow file format](../specs/workflow-format.md) |
| `when:` and `{{ }}` templates            | [Expressions](../specs/expressions.md)              |
| What `ork validate` checks               | [Graph compiler](../specs/graph-compiler.md)        |
| How a Claude node runs                   | [Runtime](../specs/runtime.md)                      |
| Layers, skills, precedence, token saving | [Context](../specs/context.md)                      |
| Messages, decisions, the event store     | [Messaging](../specs/messaging.md)                  |
| Learning from runs                       | [Feedback](../specs/feedback.md)                    |
| Commands                                 | [CLI](../specs/cli.md)                              |
| Panels                                   | [UI](../specs/ui.md)                                |

## Milestones

- **M0: bootstrap.**
  - `git init`, the monorepo skeleton, CI, README with premise and auth notes,
    licence.
  - Create the public repo with `gh repo create mimshins/ork --public` and push.
- **M1a: schema.** `packages/schema` with the Zod model, YAML round-trip, JSON
  Schema export, and the graph compiler and validator. `ork init` and
  `ork validate`.
- **M1b: runtime.**
  - `runtime-claude` with the SDK and CLI drivers behind `ClaudeRuntime`, plus
    the Ork MCP tools.
  - `ork doctor`.
  - Run a single node end-to-end (`ork run <wf> --node <id>`).
- **M1c: engine** (built: [scheduler](../specs/scheduler.md),
  [worktrees](../specs/worktrees.md), delegation and the
  [context compiler](../specs/context.md)).
  - Scheduler: flow edges, join and router, loops with `maxRounds`.
  - Ownership: delegation, reports, `spawn_worker`.
  - Worktree manager.
  - Context compiler and layer precedence; `ork context explain`.
- **M1d: human loop** (in progress; built: the
  [event store](../specs/event-store.md) with `ps`, `logs`, `tree`; the decision
  queue with `decide`, `stop` and `run --detach`; the message bus with
  `send_message`, `read_inbox` and loops asking a live owner; `chat` and
  `resume`; `claim` and `release`; feedback capture). Ship the
  `software-factory` and `pr-review` examples.
  - Feedback capture: the `feedback` tool, system signals, the local table and
    fingerprints, `ork feedback list | show | dismiss`.
- **M2: UI.**
  - Hono server with REST and SSE.
  - UI panels in this order: monitor, logs, decisions, chats, then the designer
    and context inspector.
  - The feedback loop: `ork:feedback-triage`, `ork feedback apply`, lessons,
    publishing to Discussions, export and import, and the Feedback panel.

## Verification

- **Unit tests (vitest):**
  - YAML round-trip is byte-stable.
  - Graph compiler error cases.
  - Precedence resolution fixtures: a repo with AGENTS.md only, one with
    CLAUDE.md + AGENTS.md, and a shadowed skill.
  - Expression evaluator.
  - Scheduler on a fake runtime, covering join, loop cap and escalation.
- **Integration:** the fake `ClaudeRuntime` driver replays recorded stream-json,
  so CI needs no API key.
- **End-to-end by hand:**
  - `ork doctor` passes.
  - `ork run examples/pr-review.ork.yaml` on a scratch repo completes on both
    drivers.
  - `ork tree` and `ork logs --follow` show live progress.
  - A reviewer's `ask_user` shows up in `ork decide`, and answering it resumes
    the run.
  - Worktrees are created and cleaned up.
  - A tool error and an agent's `feedback` call both appear in
    `ork feedback list`, grouped under one fingerprint across two runs, with no
    secret in the stored record.
- **M2:** drive `ork ui` in a browser:
  - Build a workflow on the canvas, save it, and `git diff` shows clean YAML.
  - Run it and watch the monitor.
  - Answer a decision and chat with a node.
