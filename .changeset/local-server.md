---
"@krapht/ork": minor
---

`ork ui` starts Ork's local server on `127.0.0.1:4417` and opens it in your
browser, signed in; run it again to open the one that is running. For now its
page lists your runs and open decisions live; the UI's panels come next. Behind
it is a JSON API with live event streams: runs, trees, events and decisions to
read, and starting, resuming, stopping, messaging runs and answering decisions,
each as the matching `ork` command does. The server runs nothing itself: closing
it stops no run. It listens on loopback only, behind a per-start token that
becomes an `HttpOnly` cookie, and refuses other hosts and other sites.

`ork logs -f` now ends as soon as a run's `run.finished` arrives over its
socket, instead of waiting for the run's process to close it.
