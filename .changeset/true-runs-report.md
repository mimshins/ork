---
"@krapht/ork": patch
---

Make runs, follow-ups and the issues flow do what the docs say. A shell
`script:` takes a heavy-command slot when one of its commands matches `heavy`. A
follow-up a live run has taken is refused (or skipped by `--follow-ups due`),
`follow-ups show` and `list` say which run took it, and a `--detach` start that
takes none leaves no run folder. A finished run's declared `outputs:` print
under its summary in `ork run`, `ork logs` and `ork attach`, and show on the run
page of `ork ui`. `ork tree` shows a crashed run's nodes as cut off or not run,
a resume counts the nodes it kept, `ork stop` marks an interrupted end, and
`ork doctor` removes the empty `queue/` folders it leaves. A missing
`schemaVersion`, an unknown workflow file, a decision id given to `ork decide`
and a gate with no terminal each say what to do.
