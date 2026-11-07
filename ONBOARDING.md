# Onboarding

This is an ordered path through Ork for someone who wants to work on it. Follow
it top to bottom: what Ork does, how its parts fit, what each part must do, how
to read the code, and how to make a change. Each step says what to read, why it
comes at that point, and what you should be able to answer afterwards. To only
use Ork, start at the [documentation center](./docs/README.md) instead.

## Stage 1: What Ork is, and use it once

### The idea and the words

**Read** the [README](./README.md), the top of
[docs/design.md](./docs/design.md), and
[specs/concepts.md](./specs/concepts.md). **Why now:** every other document uses
these words.

**You can answer:** What are a workflow, a node and a run? How do a leader, a
worker and a sub-agent differ? How does the ownership tree differ from flow
edges? Why does Ork never handle credentials?

### Run something

**Do** the [setup](./CONTRIBUTING.md#development-setup), then run this from the
root of your clone. It runs two shell commands as a workflow, so it needs no
Claude account and costs nothing. **Why now:** the rest is easier with one real
run in mind, and Stage 4 ends by tracing this one through the code.

```sh
pnpm ork validate examples   # a warning about an unregistered project is expected
alias ork="node $PWD/packages/cli/src/bin.ts"   # the CLI from source, in any folder
mkdir ../try-ork && cd ../try-ork
git init && git commit --allow-empty -m "Start"
ork init
cat > .ork/workflows/two-steps.ork.yaml <<'EOF'
schemaVersion: 1
name: two-steps
nodes:
  first: { type: tool.shell, command: echo hello }
  second: { type: tool.shell, command: "echo {{nodes.first.output.stdout}} again" }
edges:
  - first -> second
EOF
ork validate && ork run two-steps
ork logs --json              # the events it recorded
```

**You can answer:** Which events did the run record, and in what order? Where
are they? (In `.ork/runs/<run>/`, and in `~/.ork/state.db`, which Ork calls the
store.)

### Read real workflows

**Read** [pr-review](./examples/pr-review.ork.yaml) beside
[the examples guide](./docs/guides/examples.md), then
[software-factory](./examples/software-factory.ork.yaml), which the maps draw.
Look things up in [writing workflows](./docs/guides/writing-workflows.md) and
[leaders and delegation](./docs/guides/leaders-and-delegation.md). **Why now:**
the file format is what users work with, and the maps show these files running.

**Do** `ork context explain hello lead` in your scratch project, to see what a
Claude node's session would load. With a Claude login you can continue the
[quickstart](./docs/getting-started/quickstart.md) from its step 3. That spends
real tokens, up to the workflow's `limits.budgetUsd`.

**You can answer:** Which `pr-review` nodes run in parallel, and what does its
`control.join` wait for? What stops the comment being posted? In
`software-factory`, what limits the review loop?

## Stage 2: How it fits together

**Do** `pnpm map` and open <http://localhost:8791>, the
[interaction map](./docs/interaction-map/README.md). Click a card or line for
what it is, with links into the repository. `M` switches maps and `J` lists
journeys, which walk a flow step by step. **Why now:** it shows the whole
cheaply, and its cards link to the specs and code you read next. Read the maps
in this order, with these journeys:

1. **Architecture:** "Validate a workflow file", "Run one Claude node".
2. **Run lifecycle:** "Run software-factory end to end".
3. **Node roles:** "From the entries to the leaves".
4. **Context and skills:** "Compile the security reviewer's session".
5. **Messaging and decisions:** "A reviewer asks you a question".
6. **Feedback loop:** how friction in a run becomes a fix or a lesson.

Each card has a status (built, partly built, specified, planned, external). The
map is [synced by hand](./docs/interaction-map/sync.md), so it can lag the code.
Then open **Roadmap** in the top bar
([how it works](./docs/interaction-map/roadmap.md)).

**You can answer:** Which process hosts a run, and what does the server do
during one? What happens between `ork run` and a node's first model call? How
does a question from any node reach you? What has shipped, and what is next?

## Stage 3: The contracts

**Read** [specs/README.md](./specs/README.md) for its status words, then follow
a run from file to record: [architecture](./specs/architecture.md),
[workflow format](./specs/workflow-format.md),
[expressions](./specs/expressions.md),
[graph compiler](./specs/graph-compiler.md), [scheduler](./specs/scheduler.md),
[worktrees](./specs/worktrees.md), [runtime](./specs/runtime.md),
[context](./specs/context.md), [messaging](./specs/messaging.md),
[event store](./specs/event-store.md). Read the others when your work reaches
them. Finish with [gaps](./specs/gaps.md) and [limits](./specs/gaps.md#limits).
**Why now:** a spec says what a part must do, so you can read its code as an
answer to it, and some of what looks wrong in the code is a known limit.

**You can answer:** What does `ork validate` refuse? When is a node skipped? How
is a loop bounded? Where does a writing node work, and what happens to its
branch? Which layer wins when two skills share a name? What does a run keep?

## Stage 4: The code

Read the packages in dependency order, so each uses only what you have seen:
`integrations <- schema <- core <- runtime-claude, nodes <- server <- ui, cli`.
Every source file opens with a `@file` block saying what it is for. Each
`src/index.ts` only re-exports, so it lists a package's public pieces (the UI
has `src/main.tsx` instead). `test/` shows behavior with fakes and needs no
account: `pnpm exec vitest run packages/core/test/expr.test.ts` runs one file.

### `integrations` and `schema`

**Read** [integration.ts](./packages/integrations/src/integration.ts), the
`registry.ts` beside it and one adapter (`gh.ts`). Then
[workflow.ts](./packages/schema/src/workflow.ts), `nodes.ts` and `yaml.ts`, with
[yaml.test.ts](./packages/schema/test/yaml.test.ts). The `edit-*` files serve
the workflow builder and can wait. **Why now:** everything else uses these.

**You can answer:** What would adding a CLI tool take? How do a file's errors
keep their line and column? What makes saving a workflow byte-stable?

### `core`

**Read** these under `packages/core/src/`, with their tests in
[test/](./packages/core/test/). The other folders can wait until your work
reaches them. **Why now:** this is the engine, and it runs without Claude.

- `expr/` (conditions and templates), then `graph/`:
  [compile.ts](./packages/core/src/graph/compile.ts).
- `run/`: [scheduler.ts](./packages/core/src/run/scheduler.ts), then
  `routing.ts`, `delegation.ts`, `plan.ts` and `bus.ts`, beside
  [scheduler.test.ts](./packages/core/test/scheduler.test.ts).
- `runtime/`: [types.ts](./packages/core/src/runtime/types.ts), the port: an
  interface the engine defines and the Claude drivers implement. A driver is how
  Ork starts a Claude session, with the Agent SDK or your own `claude`.
- `context/resolve.ts`, `store/recorder.ts` and `worktree/manager.ts`.

**You can answer:** What does the compiler give the scheduler? What decides
which edges are taken? What does `core` know about Claude, and through what?

### `runtime-claude` and `nodes`

**Read** [registry.ts](./packages/runtime-claude/src/registry.ts), `cli.ts`,
`sdk.ts` and `tools/` (what Ork gives a session), with
[runtime.test.ts](./packages/runtime-claude/test/runtime.test.ts). Then
[builtins.ts](./packages/nodes/src/builtins.ts), `tools.ts`, `claude.ts` and
`gate.ts`. **Why now:** these implement what `core` only declares.

**You can answer:** How do the two drivers differ? What does an executor (the
code that runs one node type) get from the scheduler, and return? What checks a
tool node's command before it runs?

### `server`, `ui` and `cli`

**Read** [server.ts](./packages/server/src/server.ts) and `contract.ts`;
[main.tsx](./packages/ui/src/main.tsx), `app/app.tsx`, then `panels/` and
`workspace/`; [main.ts](./packages/cli/src/main.ts) for every command. To see
the UI, run `pnpm ui:build`, then `pnpm ork ui`. **Why now:** these are clients
of everything above.

**You can answer:** Why does the server run nothing itself? How do the UI and
the server stay in agreement? How does `ork decide` reach a run in another
process?

### Trace your run through the code

**Do** follow `ork run two-steps` with its `ork logs --json` beside you. **Why
now:** a trace joins up what you read one package at a time.

| Step                    | Where                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| The command             | [commands/run.ts](./packages/cli/src/commands/run.ts)                                               |
| Check and start         | [run/workflow.ts](./packages/cli/src/run/workflow.ts), `runWorkflowFile`                            |
| Parse and compile       | [commands/validate.ts](./packages/cli/src/commands/validate.ts), `loadWorkflow`                     |
| Run the graph           | [run/scheduler.ts](./packages/core/src/run/scheduler.ts), `startRun`                                |
| Run a node              | [tools.ts](./packages/nodes/src/tools.ts), found through `builtinExecutors`                         |
| Follow the edges        | [run/routing.ts](./packages/core/src/run/routing.ts)                                                |
| Record and print events | [recorder.ts](./packages/core/src/store/recorder.ts), [format.ts](./packages/cli/src/run/format.ts) |

A Claude node differs at "Run a node":
[claude.ts](./packages/nodes/src/claude.ts) calls `planNodeSession`, then starts
the session through the port on a driver.

**You can answer:** Where do `node.started`, `edge.taken` and `node.finished`
come from? How does `second` get the output of `first`?

## Stage 5: Why it is this way

**Read** the [ADR](./decisions/README.md) and [RFC](./rfcs/README.md) indexes,
then ADRs [004](./decisions/ADR-004-no-credentials.md) (credentials),
[005](./decisions/ADR-005-one-runtime-port-two-drivers.md) (the port),
[008](./decisions/ADR-008-ownership-hierarchy.md) (ownership),
[016](./decisions/ADR-016-scheduler-semantics.md) (how a workflow runs),
[022](./decisions/ADR-022-integration-registry.md) (adapters) and
[024](./decisions/ADR-024-event-store.md) (the store). Afterwards, look up the
ADR when a choice surprises you. **Why now:** reasons make sense once you have
seen what they produced.

**You can answer:** What did each decision rule out? Why does an `Accepted` RFC
in `rfcs/active/` not tell you what is built?

## Stage 6: Make a change

**Read** [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md),
which has the mandatory actions, the conventions and
[where things live](./AGENTS.md#where-things-live). If you work with coding
agents, read [.ai/README.md](./.ai/README.md): it indexes the
[memories](./.ai/memories/overview.md), skills and agent roles used to build
Ork, and says which source wins when two disagree (the code over the specs, the
specs over the map and docs). **Why now:** you can now tell which documents a
change touches.

**You can answer:** Does your change need an RFC, an ADR or neither? What must
change with it (test, spec, guide, map, roadmap, gaps, changeset)? What does
`pnpm check` run?
