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
   `command-code.deepseek/deepseek-v4.1-flash`) pins its session to that driver,
   and the rest goes to that tool as written. `--driver` does not override it.
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
  `model`, and `{{item.model}}`, which is rendered for each item and then
  parsed. The driver fit check runs on the rendered value, so an item that
  renders `command-code.deepseek/…` starts on Command Code
  ([for-each](../scheduler/for-each.md#an-items-own-model-and-effort)).
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
[descriptor](../runtime.md#the-drivers). `claude-code` has it; `open-code` and
`command-code` do not, for now. `ork validate` and `ork run` refuse the leader's
node, naming the sub-agent and the driver: "sub-agent `helper` runs in `lead`'s
session on driver `open-code`, which does not run subagents". A sub-agent whose
model names another driver than its leader's is refused too.

## The ready driver

- **The one ready** is what `ork doctor`'s own checks find
  ([ready.ts](../../packages/integrations/src/ready.ts)): `claude-code` is ready
  when `claude` is installed and logged in, or `ANTHROPIC_API_KEY` or
  `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY=1` is set. With more than one
  ready, a run takes `claude-code`.
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
- **The run records it** (`settings.readyDriver` on `run.started`), and
  `ork resume` keeps it, without looking again. A run recorded before this has
  none, and a resume looks.
- `--node` looks the same way for its node; `ork chat` resumes a session on the
  driver it ran with. Detached runs, called runs, the server's Run workflow and
  Propose fix, and the MCP `start_run` all start `ork run`, so they look the
  same way, on the machine running it.
- Tests pass their own checks, so no real `claude` runs
  ([tests](../../packages/cli/test/ready-driver.test.ts)).
