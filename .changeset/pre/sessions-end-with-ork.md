---
"@krapht/ork": patch
---

An agent session, and everything it started, now ends when `ork` dies by any
cause (SIGKILL, the OOM killer, a crash), on macOS and Linux: the session runs
in its own process group beside a small watcher that sends the group SIGTERM,
then SIGKILL after 2 s. Ctrl-C reaches the session through `ork`, which stops it
as before. A session that ends normally leaves its background processes as
before.
