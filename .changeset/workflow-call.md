---
"@krapht/ork": minor
---

A new node type, `workflow.call`, starts a workflow as a run of its own, in this
project or another registered one, and waits for it. Workflows can declare
`outputs:`, which later conditions and prompts read through
`{{nodes.<call>.output.outputs.*}}`. Name a `node` to wait on its report and
keep one run as a conversation, and add a `messages` channel for your agents to
write to it by name. A called run shares its caller's budget, stops when its
caller stops, and resumes when its caller resumes. A project can limit who calls
it with `calls.accept` in `.ork/project.yaml`, and `ork validate` checks what a
call names. See the guide, Working across projects.
