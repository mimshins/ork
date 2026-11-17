---
"@krapht/ork": patch
---

Ork's built-in workflows and agents no longer tell sessions to read whole files,
or to read with `cat`, `grep`, `sed` or git in Bash, against Ork's `extract`
rule.
