---
"@krapht/ork": minor
---

A node's `model` and `effort` can be a template on any agent node. They read
`inputs.*` and the output of a node that runs before it
(`model: "{{nodes.pick.output.json.model}}"`), and a `forEach` node's item as
before. `ork validate` accepts it and checks the reads like a prompt's
(`ref.input`, `ref.node`, `ref.field`, `template.not-upstream`); it still
refuses `item` off a fanned node and any template in `defaults`. The value is
read when the node's session starts. A value that is not one word, starts with
`-` or ends with `.` fails the node, and so does a read of an earlier node's
output that comes out empty; an empty input or item value uses the default as
before. A rendered `claude-code.opus` picks the driver, and a node set to resume
whose driver changed starts a fresh session, recorded as `driverChanged` on its
`node.started`. A sub-agent's templated model is read when its leader's session
starts. New example: `examples/pick-a-model.ork.yaml`.
