# Which driver a session uses

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built** (RFC-015 part 1,
[ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md);
[driver.ts](../../packages/core/src/run/driver.ts),
[model-driver.ts](../../packages/schema/src/model-driver.ts)).

One rule, for every caller (`ork run`, `--node`, `ork chat`, `ork resume`,
called and detached runs): the first that applies wins.

1. **The driver the model names.** A `model` of `<driver>.<model>`
   (`claude-code.opus`, `open-code.anthropic/claude-sonnet-5-5`,
   `command-code.deepseek/deepseek-v4.1-flash`, `codex.gpt-5.1`,
   `omp.openai/gpt-5.2`) pins its session to that driver, and the rest goes to
   that tool as written (`-m` on `codex`, `--model` on `omp`, which also reads a
   fuzzy name or a role the user configured; a node with no model runs the
   tool's own default for the account). `--driver` does not override it.
2. **`--driver`.**
3. **The node's `driver`** (or its agent's).
4. **The workflow's `defaults.driver`** (the project's `.ork/project.yaml`
   included).
5. **The driver ready on the machine running it**, found once when the run
   starts.

A workflow is committed, so nothing writes one person's driver into it;
`ork init`'s starter names none.

## The model prefix

[`driverOf(model, ids)`](../../packages/schema/src/model-driver.ts) reads a
`model` in one place, for the compiler, the driver fit check, the plan of each
`forEach` item and the Builder: the text before the first `.` is the driver when
it is a registered driver id (ids have no dots), and the rest is the model. Any
other text before a dot is part of a plain model, so
`deepseek/deepseek-v4.1-flash` and `gpt-5.1` stay plain models for the run's
driver.

- **Where it works:** `defaults.model`, a node's `model`, an agent file's
  `model`, and a template (`{{item.model}}`, `{{nodes.pick.output.model}}`,
  `{{inputs.model}}`), which is rendered when the node's session is planned and
  then parsed. The driver fit check runs on the rendered value, so an item that
  renders `command-code.deepseek/…` starts on Command Code
  ([for-each](../scheduler/for-each.md#an-items-own-model-and-effort),
  [a model from a template](../workflow-format/node-types.md#a-model-or-effort-from-a-template)).
- **A template pins nothing when validated.** `ork validate` reads the text as
  written: `{{nodes.pick.output.model}}` names no driver, so the driver fit
  check can't run before the run; the run checks the rendered one. A literal
  prefix (`claude-code.{{inputs.tier}}`) pins its driver at validate. A node
  `driver:` that disagrees with the rendered prefix fails the node when it runs.
- **A changed driver starts a resumed session fresh.** A session belongs to the
  driver it started on, so a node set to resume whose rendered model now names
  another driver starts a new session
  ([a changed driver](../scheduler/fresh-sessions.md#a-changed-driver)).
- **A prefixed node needs no `driver`.** Giving both is allowed when they agree;
  when they don't, the compiler reports an error, `model.driver`: "model
  `claude-code.opus` names driver `claude-code`, but the node sets
  `driver: open-code`; remove one, or make them agree"
  ([graph compiler](../graph-compiler/diagnostics.md#diagnostics)).
- **A driver that is not installed** is reported as `ork run`'s driver check
  reports a missing tool.
- **A written item value** (`forEach.items` text) is parsed at run, not when
  compiled ([register](../gaps.md)).
- **Events, `ork usage`, `ork ps` and the UI** show the driver and the model the
  session resolved, as before.

## Sub-agents

An `agent.subagent` runs inside its leader's session, so it needs the leader's
driver to run subagents: the `subagents` capability of the
[descriptor](../runtime.md#the-drivers). `claude-code` has it; `open-code`,
`command-code`, `codex` and `omp` do not, for now. `ork validate` and `ork run`
refuse the leader's node, naming the sub-agent and the driver: "sub-agent
`helper` runs in `lead`'s session on driver `open-code`, which does not run
subagents". A sub-agent whose model names another driver than its leader's is
refused too: `ork validate` refuses a written one, and `ork run` also refuses a
templated one, which is rendered when its leader's session is planned (the plan
reports each rendered prefix as `subagentPins`). The leader's driver is the one
the session resolves (the model's prefix, `--driver`, the node's, the workflow's
or the ready one), so `--driver open-code` or the ready driver counts as well as
a written prefix. The node fails `invalid_node`: "sub-agent `helper` runs in
`lead`'s session on driver `claude-code`, but its model `open-code.x` names
driver `open-code`". Every starter of a session applies the one check,
`pinClashes` in core's `driver.ts`: `sessionDriverOf`, `runNode` and
`resumeChat`. An `owner-asks` fork deletes `spec.agents`, so it needs none, and
`explain` only reports. The wording lives in `subagentClash`, shared with
`ork validate`'s `subagentRefusals`; a written clash is reported by both the
unfit-driver check and the pin check, so a caller dedupes the messages (a
`Set`). Resuming a recorded session re-checks the pins, so an older run can be
refused. A rendered prefix naming the leader's own driver passes, and the tool
gets the model without it. A plain model (`deepseek/x`) names no driver.

## The ready driver

- **The one ready** is what `ork doctor`'s own checks find
  ([ready.ts](../../packages/integrations/src/ready.ts)): `claude-code` is ready
  when `claude` is installed and logged in, or `ANTHROPIC_API_KEY` or
  `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set. With more than one
  ready, a run takes `claude-code`; when it isn't ready, the first ready one in
  registry order, and the line says so
  (`claude-code isn't ready, so open-code is next (\`ork doctor\` says
  why)`; `whyReady`, which `ork init` uses too).
- **An unproven driver is never ready.** A descriptor with `proven: false` gets
  a doctor check of `skip`, never `ok`, whatever is installed; with
  `--driver <id>` the run stops as above, and a node or model prefix naming it
  is refused by `ork validate` and `ork run` ("not yet proven on a real
  session"). `omp` is the one driver not yet proven (its gate run is pending,
  [its page](./omp.md)), so it is skipped by the doctor and refused by name,
  whatever is installed. The others are proven; `codex` was, on its gate run
  (2026-11-18, [the page](./codex.md#measured-on-the-gate-run)), and comes after
  the first three in registry order, so a signed-in `codex` is taken only when
  no other proven driver is ready. `omp` comes last, so once proven it is taken
  only when none of the others is.
- **`ork run` looks once, before anything starts**, and only when a session node
  names no driver and `--driver` isn't given
  ([ready-driver.ts](../../packages/cli/src/run/ready-driver.ts)). It says so in
  one line on stderr:
  `No driver is named, so the run uses the claude-code driver: the one ready here (…).`,
  or `review names no driver, so it uses …` when only some name none. With
  neither ready the run doesn't start: it names the nodes and gives each
  driver's hint, as `ork doctor` does.
- **`--driver <id>` looks at that driver only.** `ork run`, `--node`,
  `ork resume` and `ork feedback apply` run that driver's own doctor check
  (`checksHere(id)`: that one driver's doctor check) before any session starts,
  and stop when its status isn't `ok`, as the "no driver is ready" stop does:
  `--driver <id>: <id> isn't ready here (<detail>).`, its hint, then
  ``See `ork doctor`.`` Drivers named on nodes or in a model prefix are not
  checked up front (a node may sit on a branch that never runs); they fail at
  their session, as before.
- **An exact model the driver does not list stops `ork run` and `ork resume`,**
  after the checks above and before any checkout is made
  ([model-check.ts](../../packages/cli/src/run/model-check.ts)). It applies to a
  session node whose resolved driver has an `AgentDriver.models` hook (`omp`
  only: `omp models --json`, each entry's `selector`, else `provider/id`, as the
  exact `provider/model` forms), and whose model, after the driver prefix is
  stripped, has a `/` and no `{{` (`omp.fake/nope`, or `driver: omp` and
  `model: fake/nope`). A miss refuses the run with one line per node, naming the
  node and the model, saying it is not in `omp models` and asking for an exact
  `provider/model` that command lists. The match is exact and case-sensitive. A
  fuzzy name, a role, a templated model, a node on another driver and a workflow
  with no such node cost no process and say nothing; a list that fails, times
  out or is empty says nothing either. The list is read once per driver per run.
  `ork validate` stays offline and never asks; `ork run --node` and `ork chat`
  do not check ([L538 and L539](../gaps/omp-limits.md)). Tests pass their own
  list ([tests](../../packages/cli/test/model-check.test.ts)).
- **The run records it** (`settings.readyDriver` on `run.started`), and
  `ork resume` keeps it, without looking again. A run recorded before this has
  none, and a resume looks.
- `--node` looks the same way for its node; `ork chat` resumes a session on the
  driver it ran with. Detached runs, called runs, the server's Run workflow and
  Propose fix, and the MCP `start_run` all start `ork run`, so they look the
  same way, on the machine running it.
- Tests pass their own checks, so no real `claude` runs
  ([tests](../../packages/cli/test/ready-driver.test.ts)).
