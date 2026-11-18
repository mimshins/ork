---
"@krapht/ork": patch
---

On the `codex` driver, a node denied `Edit` and `Write` outright (a `readonly`
node) now runs in Codex's read-only sandbox, so it can't run commands that write
files; and a leg that ran tools without Ork's hook is stopped at once instead of
running to the end of its turn. Ork's token for its tools is kept out of the
shell Codex starts.
