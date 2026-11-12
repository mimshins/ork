---
"@krapht/ork": patch
---

A tool node's program, and everything it started, now ends when `ork` dies by
any cause (SIGKILL, the OOM killer, a crash), on macOS and Linux: a small
watcher in its process group sends the group SIGTERM, then SIGKILL after 2 s.
Before, a killed `ork run` left the program running after its integration lock
or heavy-check slot had been handed on. A program that ends normally leaves its
background processes as before.
