---
"@krapht/ork": minor
---

Readonly nodes now run read-only git (`git diff`, `log`, `show`, `status`, also
with `-C <path>`) without asking; any other command asks instead of being
impossible. New: `ork resume --detach` resumes a run in the background;
`ork projects move <id> <path>` follows a clone you moved or renamed, with its
runs; `ork feedback note <run> [<node>] -m <text>` records your own note or
rating as feedback; `ork feedback restore <item>` brings back a dismissed item.
