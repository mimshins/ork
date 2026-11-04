---
"@krapht/ork": minor
---

A leader or worker can now declare `verify:`, a program that must pass before
its report is accepted. A failure goes back to the same session, up to
`attempts` times and within its budgets, with only the end of the output, and
then the node fails.
