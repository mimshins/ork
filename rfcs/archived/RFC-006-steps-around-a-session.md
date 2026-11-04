# RFC-006 — Deterministic steps around a session, MCP calls and inline scripts

- **Status:** Implemented
- **Date:** 2026-11-04
- **Supersedes:** —
- **Superseded by:** —
- **ADR:** [ADR-049](../../decisions/ADR-049-steps-mcp-calls-and-scripts.md)

## Contents

- [Context](#context)
- [One shape for a step](#one-shape-for-a-step)
- [Options: `verify:`](#options-verify)
- [Options: hooks](#options-hooks)
- [Options: inline `script:`](#options-inline-script)
- [Options: the MCP call node](#options-the-mcp-call-node)
- [Decision](#decision)
- [Consequences](#consequences)
- [Settled questions](#settled-questions)

## Context

[ADR-047](../../decisions/ADR-047-script-identity-env-json.md) and
[ADR-048](../../decisions/ADR-048-scripts-and-rules-on-the-bus.md) let a program
know its run, return JSON a `when:` reads, and tell a session a fact with no
model turn. Four things still take a model, or are awkward by hand:

- **Nothing checks a report.** A session reports `pass` through structured
  output, and `resultOf` ([claude.ts](../../packages/nodes/src/claude.ts)) takes
  its word. `software-factory`'s builder is only told to "report pass only when
  they do". A check as a later node works in the flow, but costs a loop edge
  and, for a worker, a new session that starts over.
- **A tool node can't reach a session's checkout.** Tool nodes run in the shared
  checkout ([worktrees](../../specs/worktrees.md)), and a worker gets its own
  worktree. Nothing can install dependencies there, or check it, without a model
  turn.
- **A delegated child follows no edges.** A leader's `delegate` replaces them
  ([scheduler](../../specs/scheduler.md#delegation)), so the "tool node with an
  edge" answer to most hook requests does not reach it.
- **Calling an MCP tool takes a session.** A deterministic call to a known tool
  on a known server has no way in except a model turn, or a wrapper program the
  author writes.

Short scripts are also awkward. `command:` has no shell, so a two-line step is
`sh -c '…'` in YAML, with quoting to get right, and it invites templating values
into shell, which the [guide](../../docs/guides/scripts.md) warns against.

The author chose on 2026-11-04 to settle these together, since they share a
shape, and asked that deterministic work be the way Ork spends fewer tokens. No
figure here is measured; the `benchmark` roadmap item will measure.

## One shape for a step

`verify:` and hooks both run a program for a node, in its checkout, with its
identity. Whichever options are chosen, they should share one shape with a tool
node, so a value reaches a program one way:

```yaml
verify:
  command: pnpm test # or `script:`, below
  env: { BASE: "{{inputs.base}}" }
  timeout: 10m
```

It takes `command` or `script`, `env`, `plainEnv` and `timeout`, and reuses the
tool executor's rendering, masking and capping
([tools.ts](../../packages/nodes/src/tools.ts),
[tool-env.ts](../../packages/nodes/src/tool-env.ts)). It runs inside the node's
executor, so before `workspace.finish` commits the node's work
([context.ts](../../packages/core/src/run/context.ts)), and within its
`timeout:`.

## Options: `verify:`

A worker must not be able to report `pass` until a program agrees.

### Option A — Check after the report, resume with the failure

The executor runs the command once a session reports `pass`. On a failure, it
resumes the same session with what failed, and takes a new report, up to
`attempts`; then the node fails. The resume is the path a late message already
takes, with `lateBudget`'s spending limits.

- **Pros:** The same on both drivers. A failure lands in a session that knows
  the work, with its cache if it is still warm. Sessions that report `fail` or
  `changes_requested` spend nothing more. Only `nodes` and the schema change.
- **Cons:** Each attempt is a resume: a process start, and a model turn.

### Option B — Deny the report with a hook inside the session

`PreToolUse` on the report tool runs the command and denies the report on a
failure, so the session never ends. Ork already has such a hook for holds
([hold.ts](../../packages/runtime-claude/src/hold.ts)).

- **Pros:** No new process, and the failure arrives inside the turn.
- **Cons:** Two drivers to get right. [L29](../../specs/gaps/limits.md) shows
  managed settings can stop a hook firing, which here would let a report pass
  unchecked. A session's own timeout and budget have to cover the check.

### Option C — Fail the node, and let a loop edge retry

`verify:` only fails the node. A `when:` loop sends it back.

- **Pros:** Smallest. Nothing new for retries.
- **Cons:** A delegated child has no edges. A worker starts fresh each round
  unless `session: resume` is set, and pays again to learn what it did.

### Option D — No `verify:`; write the check as a tool node

- **Pros:** Nothing to build.
- **Cons:** It can't run in a worker's worktree or on a delegated child, which
  is the need.

## Options: hooks

The question from the task spec: what can a hook do that a tool node can't? From
the context above: **run in a node's own checkout, and apply to a delegated
child.** After a node, `verify:` and `notify:` cover the need, and an edge
covers the rest. Before a node, nothing does.

### Option A — `before:` only

One step on leaders and workers, in the node's checkout, before its session
starts. If it fails, the node fails and no model turn is spent. It runs again
each time the node runs. Its output is readable as `{{before.stdout}}` or
`{{before.json.x}}` in that node's `prompt`, so a program can gather what a
session would otherwise spend turns finding.

- **Pros:** The one thing tool nodes can't do. No session starts on a broken
  setup. A declared child gets the same setup however it is started.
- **Cons:** A new scope in a prompt's templates. A `before:` on every worker
  adds run time for each spawned instance.

### Option B — `before:` and `after:`

As A, plus `after:`, which runs however the session ended.

- **Pros:** Collects logs or tears down on failure too.
- **Cons:** No request for it yet. It needs answers for a stopped node, a
  timed-out one and a crash, each with its own failure mode. It can be added
  later.

### Option C — Lifecycle hooks in project rules

`rules:` runs a program at named points for every node, such as
`worktree.created`.

- **Pros:** Set once per project, which suits `pnpm install` in every worktree.
- **Cons:** Far from the node. Named points become a contract to keep. `before:`
  under `defaults:` could meet the same need (see Settled questions).

### Option D — No hooks

- **Pros:** Nothing to build; a session's own `.claude/settings.json` hooks
  still apply.
- **Cons:** Worktree setup keeps taking a model turn, which is what this RFC is
  for.

## Options: inline `script:`

### Option A — `script:` on `tool.shell` and steps, with no templates in it

`script:` replaces `command:`. Values arrive only through `env:`; a `{{` in the
text is a compile error (`script.template`), so a value can't become shell
syntax. `interpreter:` chooses the program, `sh` by default, and the text is
written to the run's private `.output` folder and run from there.

- **Pros:** The safe way is the only way. Short steps read well in the workflow
  file. Any interpreter works, with no per-language flag.
- **Cons:** Harder to lint and test than a file. A script that needs `{{` for
  its own reasons must build it some other way.

### Option B — `tool.script`, a new node type

- **Pros:** `command` stays required on `tool.shell`.
- **Cons:** A second node for the same thing, and steps need `script:` anyway.

### Option C — No inline scripts

`sh -c` remains, with the guide's safe pattern.

- **Pros:** Nothing to build; files are reviewable and testable.
- **Cons:** Steps get long `sh -c` strings, or a new file for each small check.

## Options: the MCP call node

A node calls one named tool on one MCP server, with no session. Which server,
and how it authenticates, is the hard part: "Ork never stores, proxies, or asks
for credentials."

### Option A — `mcp.call`, servers from the project's `.mcp.json`

```yaml
issue:
  type: mcp.call
  server: linear # a name in .mcp.json
  tool: get_issue
  arguments: { id: "{{inputs.issue}}" }
  env: { LINEAR_TOKEN: "{{env.LINEAR_TOKEN}}" }
```

Ork reads the server's definition from the file Claude Code already reads, and
starts or connects to it for this call. Output: `output.json` for a structured
result, `output.text` otherwise, and the node fails on an error result. Stdio
servers and HTTP servers with static headers work. A server that needs an OAuth
sign-in is refused with the reason, since those tokens are Claude Code's.

- **Pros:** One definition for sessions and nodes. Ork stores nothing: secrets
  stay in the user's environment, and masking applies as for `env:`.
- **Cons:** OAuth servers, a common kind, are out. Ork must follow the
  `.mcp.json` format as it changes. A server starts per call, which is slow for
  chatty ones.

### Option B — Servers declared in the workflow

A top-level `mcpServers:`, with the same `{{env.*}}` rule.

- **Pros:** The workflow file says everything it needs.
- **Cons:** A second place to define a server, and a transport's fields become
  Ork's format to keep.

### Option C — Through a Claude session on a cheap model

A one-tool worker, using whatever servers Claude Code has signed in to.

- **Pros:** Works with OAuth today, with no new code.
- **Cons:** Spends a model turn, and the model may not make the call as written.
  This is possible now, so it needs no decision.

### Option D — No MCP node

A wrapper program through `tool.shell`, and the guide says how.

- **Pros:** Nothing to build, and no new edge in the dependency graph.
- **Cons:** Each author writes a client.

`@modelcontextprotocol/sdk` is already a runtime dependency of `runtime-claude`
and the CLI ([ADR-011](../../decisions/ADR-011-in-house-mcp-server.md)), but
`nodes` would gain it, and the client side is new to Ork, so an ADR records it.

## Decision

Decided by the maintainer on 2026-11-04.

- **`verify:`, Option A:** after a `pass`, with up to `attempts` resumes,
  default 1. It's the only form that keeps a delegated child honest on both
  drivers.
- **Hooks, Option A:** `before:` only, because it's the one need a tool node
  can't meet. `after:` can follow if asked for.
- **`script:`, Option A:** no templates in the text.
- **MCP, Option A:** `mcp.call`, servers from `.mcp.json`, no OAuth.

**What goes back to a session stays small.** A failed check sends the last 8 KiB
of its output, and the path of a file with the rest. A session's cost grows with
what it holds, so the engine should not hand it a full test log.

**Order:** `script:` and the step shape, then `verify:`, then `before:`, then
`mcp.call`, each reviewable alone, as `verify:` and `before:` want `script:`,
and `mcp.call` is independent and has the most open questions.

## Consequences

- A leader or worker can't report `pass` past a failing check, with no prompt
  engineering. A retry costs a resume rather than a new session.
- A broken setup fails before any model turn, and a program can gather a
  session's starting facts.
- `notify:` already fires after a node's result, so it reads the verified one.
- `schemaVersion` stays 1, as these are optional additions.
- `command` becomes optional on `tool.shell`, with a check that exactly one of
  `command` and `script` is given; the JSON Schema and serializer change.
- `verify:` output adds `verify` to a node's output fields, for `when:` and
  templates.
- Limits to register: OAuth MCP servers, `.mcp.json` from one project only, a
  server started per call, and a late or verify turn counting a session's whole
  cost (L92).
- Follow-up: an ADR per decision or one for all; specs for the workflow format,
  scheduler and tool nodes; `docs/guides/scripts.md`; the map; an example.

## Settled questions

With the proposed answers, on 2026-11-04.

1. **`verify:` runs on any report but `fail` and `changes_requested`,** which
   accept nothing. That includes `done`, so a session can't report its way past
   a check.
2. **A session is told the check,** in one line of its system prompt, so it can
   run the check itself first and often save the resume.
3. **`defaults:` may set `before:`,** which is how a project gets `pnpm install`
   in every worktree without a lifecycle system.
4. **`script:` runs under `sh -eu` by default,** because failing clearly beats
   guessing, though it differs from what `sh file` does.
5. **`.mcp.json` comes from the project's root,** as `projectRoot` means for
   skills, including for an attached workflow.
