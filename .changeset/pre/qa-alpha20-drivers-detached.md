---
"@krapht/ork": patch
---

When claude-code isn't ready and other drivers are, `ork run` and `ork init` say
so instead of naming another driver as first. A detached run no longer passes
`ORK_DETACHED` to its nodes, so an `ork run --detach` they start detaches. The
QA kit puts a fake `opencode` on its PATH.
