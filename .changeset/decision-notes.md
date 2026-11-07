---
"@krapht/ork": minor
---

Answer any decision with an optional note. A `human.gate` outputs it as `note`
(`{{nodes.<gate>.output.note}}`, empty when none), so a `revise` answer can say
what to change; `ask_user` returns it with the choice; a denied tool's message
ends with it. Give it with `ork decide --id … --choose … --say "…"`, in the
Decisions panel's "Note for the run" box, or on the run's terminal as an
optional line after the choice (Enter skips it). It is stored masked with the
decision and shows in `ork logs` and the panel's Settled list. `--note` and
`--rating` keep recording feedback about the node, as before.
