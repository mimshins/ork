---
"@krapht/ork": minor
---

Short flags mean the same in every command: `-a --all`, `-d --detach`,
`-f --follow`, `-i --input`, `-m --message`, `-n --limit`, `-o --output`,
`-p --project` and `-y --yes`, from one table, so `ork decide -f` and
`ork ps -p all -n 5` work. Help shows a long alias as "also --watch". A
question's options show their label first and the id dimmed in parentheses
(`Allow (allow)`).
