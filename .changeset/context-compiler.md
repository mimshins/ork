---
"@krapht/ork": minor
---

Each Claude node's session is now compiled from its layers. Skills in
`~/.ork/skills`, the workflow's `layers.skills` and a node's `skills` load as
`ork:<name>` through a plugin Ork writes for the node; a project skill they
shadow, or one `layers.project.skills` leaves out, is switched off; and
`~/.ork/context`, `layers.context`, `.ork/lessons/<workflow>.md` and a node's
`context` are added to its system prompt. References are `ork:<name>` or paths
relative to the workflow file, and `ork validate` reports the ones that resolve
to nothing. New: `ork context explain <wf> <node>` shows what a node's session
loads, layer by layer, with estimated tokens. Ork leaves `AGENTS.md` to Claude
Code, and `ork doctor` warns when `claude` is older than 2.1.281.
