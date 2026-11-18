---
"@krapht/ork": patch
---

A session Ork stopped, with no report, ends as interrupted on every driver,
whatever result its tool printed as it was cut off (Claude Code's
`error_during_execution` no longer reads as an unknown end). `ork onboard`'s
check of the writer's files reads, commits and checks a project that is a
subfolder of its repository from the project folder, and refuses a file outside
it.
