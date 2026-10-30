# Memory template

Copy to `.ai/memories/<kebab-topic>.md`. Memories orient an agent quickly; they
describe the **present** and **link** to `specs/`, `decisions/`, and code rather
than restating them. History belongs in ADRs, RFCs, and git. Add the memory to
the index in `.ai/README.md`.

```md
---
description: <what this covers and when an agent should read it>
last-verified: YYYY-MM-DD (commit <short-sha>)
---

# <Title>

<!-- Current state only; link instead of copying. -->
```
