---
"@krapht/ork": minor
---

Sessions get an `extract` tool that reads a range of lines, searches, or shows a
`git` diff, `show` or `log`, cuts the text with `head`, `tail` or `match`, and
returns only that (16,000 characters at most, with a count footer), so a whole
file or a long diff does not stay in the conversation. It refuses paths outside
the session's folder and secret-looking files, and Ork's notes to every node
tell it to prefer `extract` over `cat`, `sed` and `rg`. `pnpm benchmark` also
writes `carried.json`, the carried weight by role and kind.
