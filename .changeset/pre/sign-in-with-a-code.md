---
"@krapht/ork": patch
---

`ork ui` signs the browser in with a one-time code: it gets a single-use code
(good for 60 seconds) from the server and opens `/?code=…`, so the API token is
no longer on the browser opener's command line or in the browser's cookie, which
now holds a separate session secret. A used, expired or wrong code is refused
with one message, and a path that begins with `//` no longer redirects off the
server. Upgrade: a tab signed in before, and an old `?token=` link, stop working
once; run `ork ui` again.
