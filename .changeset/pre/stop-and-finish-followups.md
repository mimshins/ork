---
"@krapht/ork": patch
---

`ork stop` ends a node waiting for a heavy slot at once and never resumes a
stopped session. `ork onboard`'s check of a subfolder project skips Command
Code's empty `.commandcode/taste/taste.md` at the repository's top, and runs
`git diff` with `-c diff.relative=false`, so it works on git older than 2.28.
