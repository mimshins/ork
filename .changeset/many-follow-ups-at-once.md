---
"@krapht/ork": patch
---

`ork follow-ups done`, `drop`, `reopen` and `due` take several ids, space or
comma separated, and change none of them if any id is unknown or can't take the
action. The other commands that take one id (`follow-ups show`, `post`,
`published` and `list`, `pause`, `continue`, `attach`, `stop`, `resume`, most of
`feedback` and `projects forget | move`) refuse a second one with "Unexpected
argument". A follow-up held by a run the store doesn't know yet now reads "not
started yet; free in under 2 minutes" instead of "still running".
