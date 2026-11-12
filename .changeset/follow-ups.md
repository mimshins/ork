---
"@krapht/ork": minor
---

Follow-ups keep what a change leaves for later, apart from feedback: a message
to a partner, work for another project's agent, infra steps, a check after
deploy. Sessions leave them with a new `follow_up` tool (30 a session,
duplicates merged),
`ork follow-ups list | show | add | done | drop | reopen | due | post | published`
manages them, and the Follow-ups panel in `ork ui` does the same, with a due
count on its tab. A project's new `followUps` rule keeps them in Ork's store
(the default), in a file in your repository, or as GitHub issues through your
own `gh`. An `after-merge` follow-up becomes due when `gh` shows its pull
request merged, checked on every call and every 10 minutes under `ork watch` and
`ork ui`. A follow-up for another registered project goes into its list and,
when a run is live there, to its session. Ork drafts messages and never sends
them: you send them, or confirm a comment on an issue with
`ork follow-ups post --confirm`. `ork run <workflow> --follow-ups <ids>` takes
an agent's changes as a run's `brief`, and `build` asks you once what to do with
the follow-ups it finds, does the small ones in one more round, and records the
rest once the change is published.
