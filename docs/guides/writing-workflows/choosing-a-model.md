# Choosing a model while the run goes

_Part of [Writing workflows](../writing-workflows.md)._

A node's `model` and `effort` can be a template, so a run decides them: from an
input you give, or from what an earlier node reported. A security fix runs on
Opus and a typo on Sonnet, without two copies of the worker. The whole example
is [examples/pick-a-model.ork.yaml](../../../examples/pick-a-model.ork.yaml).

## Contents

- [From an input](#from-an-input)
- [From an earlier node's output](#from-an-earlier-nodes-output)
- [What `ork validate` checks](#what-ork-validate-checks)
- [What happens when the node starts](#what-happens-when-the-node-starts)
- [A model on another driver](#a-model-on-another-driver)

## From an input

```yaml
inputs:
  level:
    type: string
    default: medium
nodes:
  review:
    type: agent.worker
    prompt: Review the change.
    effort: "{{inputs.level}}"
```

`ork run --input level=high` reviews at `high`. It works the same for `model`.

## From an earlier node's output

Ork has no `if` in a template, so a small node chooses and the worker reads what
it reported. Here a script maps an issue's labels to a model name:

```yaml
nodes:
  pick:
    type: tool.shell
    script: |-
      case ",$LABELS," in
        *,security,* | *,money,*) model=claude-code.opus ;;
        *) model=claude-code.sonnet ;;
      esac
      printf '{"model":"%s"}\n' "$model"
    allow:
      - sh
    env:
      LABELS: "{{inputs.labels}}"
    output:
      format: json
      schema:
        model: string
  work:
    type: agent.worker
    prompt: "Do this task: {{inputs.task}}"
    model: "{{nodes.pick.output.json.model}}"
edges:
  - pick -> work
```

An agent node can choose too: give it `output: { schema: { model: string } }`
and read `{{nodes.pick.output.model}}`. A node that reads another's output must
run after it, so an edge or a chain of edges leads from `pick` to `work`.

## What `ork validate` checks

A `model` or `effort` template is checked like a prompt's reads: an unknown
input, node or field is reported (`ref.input`, `ref.node`, `ref.field`), and so
is a node that does not run first (`template.not-upstream`). `{{item.model}}` on
a node without `forEach`, `{{index}}` off a fanned node, and any template in
`defaults:` are refused: `defaults` belongs to no node, so put the template on
the node. Ork keeps no list of model names, so a wrong name shows when the
session starts, not at `ork validate`.

## What happens when the node starts

The template is read when the node's session starts, with the run's inputs and
the outputs so far.

- The value must be one word: no space, brace or quote, no `-` at the start (it
  would read as a flag of the agent's tool) and no `.` at the end. An `effort`
  must be `low`, `medium`, `high`, `xhigh` or `max`. Anything else fails the
  node and says so.
- A read of an earlier node's output that comes out empty fails the node:
  `model: {{nodes.pick.output.model}} gave nothing: node pick has no output or an empty one`.
  An empty `inputs.*` value uses the node's default instead, then `defaults:`,
  then the tool's.
- `ork run --node work`, `ork chat` and an owner's fork run a node on its own,
  without the earlier outputs. The node takes its default model and the run says
  the read was empty.
- A sub-agent's templated `model` is read when its leader's session starts. An
  empty one keeps the leader's model, and an invalid one fails the leader. A
  sub-agent's read of an earlier output that comes out empty fails the leader
  too, except in a node run alone, where it is a warning.

`ork usage` and the run's transcript show the model a session really used.

## A model on another driver

A rendered `claude-code.opus` picks its driver as a written one does
([drivers](../drivers.md)). `ork validate` can't know it ahead of the run, so a
template pins no driver: write the prefix yourself,
`model: "claude-code.{{inputs.tier}}"`, when you want the driver checked up
front. A node `driver:` that disagrees with the rendered prefix fails the node
when it runs.

A sub-agent runs in its leader's session, so it runs on the leader's driver. A
sub-agent whose rendered model names another driver fails the leader's node:
``sub-agent `helper` runs in `lead`'s session on driver `claude-code`, but its model `open-code.x` names driver `open-code` ``.
This holds whether the leader's driver comes from its model's prefix, `--driver`
or the ready driver. A rendered `claude-code.haiku` under a `claude-code` leader
passes, and the tool gets `haiku`.

A session belongs to the driver it started on. A node with `session: resume`, or
a leader, whose model now names another driver starts a fresh session instead
and the node's start event records the two drivers (`driverChanged`) and
`ork logs` says so under the start line
(`starts a fresh session: driver changed from claude-code to open-code`);
`ork resume` does the same. A different model on the same driver still resumes.
A fresh session starts without the old one's history, as in
[a fresh session for a builder's next task](../fresh-builder-sessions.md#what-the-fresh-session-knows).
