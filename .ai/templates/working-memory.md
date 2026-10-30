# Working memory template

Copy to `.ai/memories/working/<kebab-topic>.md` for in-flight context that must
survive between sessions or tools. Resolve it before the linked change lands:
promote the durable parts, then delete the file. A working memory idle for 30
days is promoted, updated, or deleted.

```md
---
description: <what is being investigated or built>
status: active # active | blocked | ready-to-promote
related: <branch, issue, RFC, or spec>
created: YYYY-MM-DD
---

# <Title>

## Context

## Findings / hypotheses

## Open questions

## To promote on resolution

<!-- specs/ / ADR / RFC / memory / skill targets -->
```
