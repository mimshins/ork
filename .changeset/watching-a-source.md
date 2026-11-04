---
"@krapht/ork": minor
---

Wait on something outside a run, or start one when it happens, with no model
turn until it does. A tool or MCP node takes `watch: { every, until, timeout }`,
looking again until a condition holds: the time between looks doesn't count as
work, it holds no session slot, and `$ORK_STATE` keeps what a script has seen.
`ork watch` runs the triggers in a project's `triggers.yaml`, starting a run for
each new thing a check reports. Its first look starts nothing, each key starts
once, the workflow must have a budget, and each trigger has a daily cap and
takes one run at a time. It runs only what you accepted on this machine with
`ork watch --accept`, in a terminal. See the guide, Watching a source.
