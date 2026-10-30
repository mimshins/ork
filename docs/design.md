# Ork design (v1)

Ork is a local "n8n for agents": you design workflows of agent and tool nodes,
serialize them to git-friendly files, and run them on your own machine from a
CLI (`ork`) or a localhost web UI (`ork ui`).

Nodes form an **ownership hierarchy**. A node owns its descendants, gives them
only the context they need, and gets summaries back. The goal is a harness that
builds in good practice: token saving, context engineering, bounded loops,
quality gates, a human in the loop, and full observability.

**Credentials.** Anthropic's terms do not allow third-party tools to offer
claude.ai login or to store or relay claude.ai credentials. Ork therefore never
handles credentials: "connecting an account" means each tool's own login
(`gh auth login`, `aws sso login` or a profile, `claude` or `ANTHROPIC_API_KEY`,
Bedrock or Vertex). Ork only detects these and reports their status.

## Core concepts

| Concept            | Meaning                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow**       | A serializable graph: nodes, ownership tree, edges, inputs, layers of skills and context.                                                                                           |
| **Node**           | A typed unit, e.g. `claude.leader`, `claude.worker`, `claude.subagent`, `tool.gh`, `tool.aws`, `tool.shell`, `control.*`, `human.gate`.                                             |
| **Ownership tree** | Each node has an optional `parent`. An owner delegates to children, compiles their context, receives their reports, merges their worktrees, and handles their escalations.          |
| **Edges**          | `flow` edges carry data and control in the n8n style, with optional `when` conditions and `maxRounds` for loops. `message` edges declare who may talk to whom outside the tree.     |
| **Context packet** | What an owner hands a child: a brief, selected artifacts (by path), relevant skills, and constraints. Never the owner's full transcript.                                            |
| **Report**         | What a child returns: status, a short summary, artifact paths, branch, and token and cost usage.                                                                                    |
| **Decision**       | A blocking question to the user: question, options, recommended option, context, and an optional default on timeout. Questions from all nodes are collected in one Decisions inbox. |
| **Run**            | One execution of a workflow. Every change is stored as an append-only event stream, which UI and CLI replay.                                                                        |

**Kinds of Claude node:**

- **Leader:** a long-lived session. It plans, delegates to declared children or
  spawns workers from a template (up to a cap), reviews reports and merges.
- **Worker:** a fresh session for each task, in its own worktree and branch,
  reporting to its owner.
- **Sub-agent:** runs _inside_ its parent's session as a Claude Code subagent
  (SDK `agents` option or CLI `--agents`). It is cheap and isolates context, but
  has no separate process.

---

## Architecture: pnpm monorepo

```
ork/
  packages/
    schema/          Zod schemas → JSON Schema; YAML load/save with stable formatting; migrations
    core/            graph compiler & validator, scheduler, context compiler, message bus,
                     decision queue, event store (SQLite + JSONL), worktree manager
    runtime-claude/  ClaudeRuntime interface + drivers: sdk (@anthropic-ai/claude-agent-sdk), cli (claude -p stream-json)
    nodes/           built-in node-type registry (each: schema, defaults, execute(), UI metadata)
    server/          Hono: REST + SSE event stream; serves built UI; local-only bind 127.0.0.1 + token
    cli/             `ork` bin (citty): init, validate, run, ps, logs, chat, decide, ui, doctor, context
    ui/              (M2) Vite + React + @xyflow/react + TanStack Query + zustand
  examples/          software-factory.ork.yaml, pr-review.ork.yaml, …
  docs/
```

- **Tooling:** Node 24 (runs the TypeScript sources directly), pnpm workspaces
  with supply-chain policies, tsdown for publishing, vitest, oxlint (type-aware)
  and oxfmt, and GitHub Actions CI.
- **Licence:** MIT (default; easy to change before the first release).
- **Single process:** `ork run` hosts the engine in-process. `ork ui` starts the
  same engine together with the server. The CLI talks to a running server over
  HTTP if one is running, and otherwise runs the engine embedded.

### Runtime adapter (`packages/runtime-claude`)

```ts
interface ClaudeRuntime {
  start(spec: SessionSpec): Session; // cwd, model, systemAppend, skills, mcp, permissions, budget
}
interface Session {
  events: AsyncIterable<OrkEvent>; // normalized assistant/tool/result/usage events
  send(msg: UserMessage): void; // injected at safe boundary (between turns)
  interrupt(): Promise<void>;
  sessionId: string; // for resume
}
```

| Concern            | SDK driver                                                       | CLI driver                                                                   |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Session and prompt | `query()` with streaming input (`AsyncIterable<SDKUserMessage>`) | `claude -p --input-format stream-json --output-format stream-json --verbose` |
| Ork tools          | In-process `createSdkMcpServer`                                  | Local Ork MCP server over HTTP, passed with `--mcp-config`                   |
| Permission gate    | `canUseTool` → Decision                                          | `--permission-prompt-tool mcp__ork__permission` → Decision                   |
| System prompt      | `systemPrompt: {preset:'claude_code', append}`                   | `--append-system-prompt-file`                                                |
| Settings sources   | `settingSources`                                                 | `--setting-sources`                                                          |
| Limits and resume  | `maxTurns`, `maxBudgetUsd`, `resume`                             | `--max-turns`, `--max-budget-usd`, `--resume`                                |

**Usage accounting:**

- Take token usage from the final `result` message: `usage` plus `modelUsage`,
  so subagent tokens are included.
- Deduplicate per-step messages by `message.id`.
- In streaming mode each turn reports running totals, so read the latest one
  rather than summing.

---

## Workflow file format

**Files:**

- `.ork/workflows/<name>.ork.yaml`: the committed workflow.
- `.ork/workflows/<name>.layout.json`: optional canvas positions, kept separate
  so that logic diffs stay clean.

**Serialization rules:**

- Stable node ids.
- Deterministic key order.
- No absolute paths.
- Secrets only as `env:` references.
- `schemaVersion` with migrations.
- A published JSON Schema for editor autocomplete.

The canonical example is
[examples/software-factory.ork.yaml](../examples/software-factory.ork.yaml).
Edges use a shorthand where possible:

```yaml
edges:
  - spec -> builder
  - builder -> security, ux, code # fan-out
  - security, ux, code -> reviews # fan-in
  - from: reviews
    to: builder
    when: any(statuses, 'changes_requested')
    maxRounds: 2 # every cycle needs a bound
```

**Graph rules:**

- Templates use a small, safe expression language: `{{inputs.*}}`,
  `{{nodes.<id>.output.*}}` and `when:` predicates. No arbitrary JS.
- The graph compiler rejects:
  - cycles that have no `maxRounds`;
  - an unknown `parent`;
  - message edges that point to missing nodes;
  - skill references that don't resolve.

**Built-in node types in v1:**

- **Agents:** `claude.leader`, `claude.worker`, `claude.subagent`.
- **Tools:** `tool.gh`, `tool.aws`, `tool.shell` (each runs the user's own CLI,
  and a per-node allowlist sets which subcommands are permitted).
- **Control:** `control.split`, `control.join` (all, any or n),
  `control.router`. Loops are edges with `maxRounds`, not a node.
- **Human:** `human.gate`.
- **Edges:** `input`/`output` artifacts.

---

## Context engineering, skills and precedence

**Layers** (lowest to highest precedence for same-named skills or conflicting
instructions):

1. **Ork built-ins:** skills that ship with Ork, namespaced `ork:*`.
2. **User global:** `~/.ork/skills`, `~/.ork/context`.
3. **Project repo:** `CLAUDE.md`, `AGENTS.md`, `.claude/skills`,
   `.claude/agents`.
4. **Workflow:** `layers.skills`, `layers.context`, and the workflow's accepted
   lessons in `.ork/lessons/<workflow>.md`.
5. **Node:** explicit `skills`, `context` and `instructions` on the node.

The rule is that more explicit and more local wins. Only one source of the same
kind is ever loaded, so nothing is loaded twice.

**How the context compiler builds each node's session:**

- **Project layer:** passed through Claude Code's own loading
  (`settingSources: ['project','local']`, never `'user'`) so the repo works
  natively. The node's `skills` allowlist enforces
  `project.skills: allowlist|ignore` and removes project skills shadowed by a
  higher layer.
- **AGENTS.md:** the CLI reads it only when no CLAUDE.md exists, and the SDK may
  not read it at all. So if the repo has AGENTS.md and no CLAUDE.md, Ork appends
  it once itself, and otherwise never adds it.
- **Ork, user, workflow and node layers:** generated into a per-run local plugin
  directory and passed through `plugins`. Plugin skills are namespaced, so they
  never collide at runtime. Precedence is resolved at compile time.
- **`ork context explain <node>`** prints the resolved stack: which file came
  from which layer, what was shadowed, and the estimated tokens.

**Token-saving practices built into the engine:**

- **Fresh agent per task:** workers start clean; only leaders are long-lived.
- **Briefs, not transcripts:** owners pass context packets and children return
  short summaries. Outputs over a threshold go to the run's artifact store and
  are referenced by path.
- **Cache-friendly prompt order:** stable prefix (system preset, skills, project
  docs, workflow context) first, the per-task brief last. Ork sets
  `ENABLE_PROMPT_CACHING_1H=1` for leaders.
- **Model tiers and caps:** a model per node. Reviewers and sub-agents default
  to sonnet or haiku. Each node has `maxTurns` and `budgetUsd`, and the run has
  a total budget cap.
- **Bounded loops:** every cycle needs `maxRounds`. When a node hits its limit,
  it escalates to its owner, and the root escalates to a Decision.
- **Claims:** a node can claim files or resources via the `ork__claim` tool, so
  parallel workers don't collide.

---

## Messaging, decisions, logs

**Ork MCP tools injected into every Claude node:**

- `send_message(to, body)`
- `read_inbox()`
- `report(status, summary, artifacts)`
- `delegate(child, brief)`: leaders only.
- `spawn_worker(template, brief)`: leaders only, capped.
- `ask_user(question, options[], recommended, context)`
- `claim(resource)` and `release(resource)`
- `feedback(kind, target, title, body, severity, evidence[])`: capped per
  session; see [Feedback and self-improvement](#feedback-and-self-improvement).
- `permission`: CLI driver only.

**Message bus:**

- Lives in-process in `core/`.
- Addressing is checked against the ownership tree plus the `messages` edges.
- A message reaching a busy session is queued, with a priority gate: user
  messages and decision answers first. It is injected between turns through
  `Session.send`.

**Decisions:**

- `ask_user` calls, permission prompts and `human.gate` nodes all become
  Decision records, and the asking node waits.
- Answer them in the CLI with `ork decide` (an interactive picker; the
  recommended option is preselected) or in the UI inbox.
- An optional `timeout` and `default` let unattended runs continue.

**Event store:**

- Append-only events (`node.started`, `msg.sent`, `tool.called`, `usage`,
  `decision.opened`, …) in SQLite at `~/.ork/state.db`.
- A JSONL copy for each run, at `.ork/runs/<runId>/events.jsonl`. The `runs/`
  directory is gitignored.
- Logs, the system monitor, chats and replay are all views over this stream.

**Chat:** `ork chat <run> <node>` (or the UI chat panel) sends a user message to
a node's live session or resumes a finished one with `resume`.

---

## Feedback and self-improvement

Every run teaches something: a tool that got in the way, a brief that missed
context, an `AGENTS.md` that is out of date. Ork captures that feedback locally,
groups it, turns accepted feedback into fixes and lessons, and lets you publish
feedback about Ork itself to its GitHub Discussions.

**Three sources:**

| Source             | How it is captured                                                                                                                                                                                                | Why                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **System signals** | Derived from the event store, with no model call: a loop hit `maxRounds`, an escalation, a budget overrun, a permission denial, a tool error, a decision that timed out, the user overriding a recommended option | Free and objective                                |
| **Agent reports**  | The `feedback` tool every Claude node gets                                                                                                                                                                        | Agents see friction that no event shows           |
| **Human notes**    | Rating or annotating a node's result in `ork decide`, `ork feedback`, or the UI                                                                                                                                   | The best signal for whether a result was _useful_ |

**The `feedback` tool:**
`feedback(kind, target, title, body, severity, evidence[])`.

- `kind`: `friction`, `bug`, `context-gap`, `skill`, `workflow`, or `idea`.
- `evidence`: event ids and artifact paths, never pasted file contents.
- The tool's description tells the agent to report only what materially got in
  its way, in one line plus a short body.
- Ork caps reports per session (default 3) and drops duplicates within a run, so
  feedback stays cheap in tokens.

**Three targets**, because each has a different audience:

| Target     | About                                                        | Goes to                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `ork`      | The harness: tools, drivers, engine, expression language     | Local, and publishable to Ork's GitHub Discussions     |
| `workflow` | This workflow's design: briefs, models, budgets, loop bounds | Local: the workflow's author, `ork feedback apply`     |
| `project`  | The repo's context: `AGENTS.md`, `CLAUDE.md`, skills, docs   | Local: the project's maintainers, `ork feedback apply` |

Ork pre-fills the `target` from the evidence (a tool error is `ork`; a missing
input in a brief is `workflow`), and the agent may override it.

**Storage, local first:**

- A `feedback` table in `~/.ork/state.db`. Each record has:
  - its origin: id, time, source, run, workflow name and content hash, node,
    node type, model, driver, Ork version;
  - its content: kind, target, severity, title, body, evidence;
  - its lifecycle: status and fingerprint.
- Status moves `new → triaged → accepted | dismissed`, then `published` or
  `resolved`.
- Each record is also a `feedback.recorded` event in the run's stream, so logs
  and the UI show it in context.
- Secrets are masked when a record is written, with the same patterns the
  publish redaction uses. The local database never holds a token either.
- Records carry a `feedbackVersion` so the format can evolve with migrations.

**Grouping into items:**

- A **fingerprint** (target, kind, tool or error code, normalized title) groups
  raw records into **items**.
- An item records its count, first and last seen, and the runs, workflows and
  models it was seen in. A thousand records become a short list.
- `ork feedback triage` runs the built-in `ork:feedback-triage` workflow over
  new items. It merges near-duplicates, writes a summary for each item, and
  proposes a fix. Ork improves itself with its own engine.

**Closing the loop locally:**

- **Fixes:** `ork feedback apply <item>` runs a node that proposes a fix as a
  diff: a workflow edit, or an `AGENTS.md`, `CLAUDE.md` or skill change on a
  branch.
  - The proposed fix is a Decision; nothing is applied without your answer.
- **Lessons:** you can accept an item as a **lesson**.
  - Lessons are kept in `.ork/lessons/<workflow>.md`, a committed file you can
    review, edit, and version with git.
  - They are loaded as part of the workflow layer of the context stack, under a
    token cap (default 1,500 tokens).
  - `ork context explain` shows them like any other context.
- **Trust:** feedback is model output and repo content can steer it (prompt
  injection), so a lesson or fix only takes effect after a human accepts it.

**Publishing to Ork's Discussions (opt-in, per item):**

1. `ork feedback publish <item>` works only on `ork`-target items.
2. Ork redacts the item:
   - secrets;
   - absolute paths, rewritten to `<project>/…`;
   - emails and hostnames;
   - optionally, repo and workflow names.
3. Ork adds a structured header: Ork version, driver, model, node type, kind,
   count.
4. It shows the exact text as a Decision.
5. Only after you confirm does it post, with **your own `gh`**, to the "Agent
   feedback" Discussions category of `mimshins/ork` (slug `agent-feedback`,
   found by slug, never by id).

Deduplication and scale:

- **Fingerprint marker:** every post carries a hidden
  `<!-- ork-fingerprint: … -->` marker.
- **Existing thread:** Ork searches for it first. If a matching thread exists,
  it adds a comment with the new context and a "+1" instead of a new discussion,
  so maintainers see one thread per real problem, with a count.
- **No backend:** there is no Ork-run telemetry service. Publishing uses your
  account, like every other integration.
- **Adapters:** publish targets are adapters. `ork feedback export` and `import`
  move feedback as JSONL, so teams can share it without GitHub. Issues in the
  project's own repository can be a later adapter.
- **Maintainer side (later):** a scheduled job runs the same triage workflow
  over the Discussions category and promotes the top clusters to issues.

## CLI (milestone 1)

```
ork init                         # scaffold .ork/, .gitignore entries, example workflow
ork doctor                       # check node, git, claude (login or API key), gh auth, aws identity
ork validate <wf>                # schema + graph compile; prints errors with yaml line numbers
ork run <wf> [--input k=v] [--detach] [--driver sdk|cli]
ork ps / ork logs <run> [--node n] [--follow]
ork tree <run>                   # live ownership tree with status, tokens, $ per node
ork decide [<run>]               # answer pending decisions
ork chat <run> <node>
ork stop|resume <run>
ork context explain <wf> <node>
ork feedback [list|show|dismiss] # local feedback items (triage, apply, lesson, publish: M2)
ork ui [--port 4417]             # milestone 2
```

## UI (milestone 2): `ork ui` on localhost

**Panels:**

- **Designer:** a React Flow canvas. A palette of node types (Claude leader,
  worker and sub-agent; GitHub; AWS; shell; control; human gate), an inspector
  for each node with a skill picker that shows which layer each skill comes
  from, and a validation overlay. It saves exactly the same YAML and layout
  files.
- **System monitor:** a live graph and ownership tree with status, tokens and
  cost.
- **Chats:** one conversation per node.
- **Decisions inbox:** shaped like the Question tool, with the question, the
  options, the recommended option and one-click answers.
- **Logs:** a filterable event stream.
- **Context inspector:** the resolved layer stack for each node.
- **Feedback:** items grouped by fingerprint and target, with triage, apply,
  accept as a lesson, and the publish preview.

**Style:** dark and dense, inspired by reference image 1.

---

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
  - Run a single node end-to-end.
- **M1c: engine.**
  - Scheduler: flow edges, join and router, loops with `maxRounds`.
  - Ownership: delegation, reports, `spawn_worker`.
  - Worktree manager.
  - Context compiler and layer precedence; `ork context explain`.
- **M1d: human loop.** Message bus, decisions, event store; `logs`, `tree`,
  `decide`, `chat`, `stop`, `resume`. Ship the `software-factory` and
  `pr-review` examples.
  - Feedback capture: the `feedback` tool, system signals, the local table and
    fingerprints, `ork feedback list | show | dismiss`.
- **M2: UI.**
  - Hono server with REST and SSE.
  - UI panels in this order: monitor, logs, decisions, chats, then the designer
    and context inspector.
  - The feedback loop: `ork:feedback-triage`, `ork feedback apply`, lessons,
    publishing to Discussions, export and import, and the Feedback panel.

---

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
