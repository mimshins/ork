---
"@krapht/ork": patch
---

Each driver now declares what it does itself (`capabilities`) and whether it is
`proven`. `ork doctor` finds the `opencode` and `cmd` binaries and lists
`open-code` and `command-code` as unproven; neither is taken as the ready driver
until a real session has proven it.
