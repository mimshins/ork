---
"@krapht/ork": minor
---

`ork run ork:security-audit` is a security audit that ships with Ork and works
in any project set up with `ork init`: free scanners (`pnpm audit` or
`npm audit` by your lockfile, GitHub workflow pinning and permissions,
credential formats), then read-only agents hunt and verify, and the report goes
to `~/.ork/audits/<project>/<run-id>/`, outside the project, marked as possibly
sensitive. `quick` costs at most $29 and `standard` at most $72. A built-in
workflow can now carry companion files, written beside it under
`.ork/runs/.builtin/<hash>/`. A project attached with `ork register` is refused
by the first step, naming `ork init`. This repository's `ork run audit` is now
`ork run ork:security-audit`.
