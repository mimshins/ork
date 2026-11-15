---
"@krapht/ork": minor
---

`ork feedback resolve <item>…` marks feedback items fixed by hand resolved,
taking several ids (space or comma separated) and changing none when one is
unknown, dismissed, or resolved or published already. `ork feedback list` and
the Feedback panel hide resolved items by default, as they hide dismissed ones,
and a resolved item that is seen again after it was resolved goes back to `new`.
