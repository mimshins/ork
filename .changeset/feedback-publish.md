---
"@krapht/ork": minor
---

`ork feedback publish <item>` shares feedback about Ork itself with its
maintainers, in the "Agent feedback" category of its GitHub Discussions, with
your own `gh`. Ork redacts it (secrets, your projects' paths, home folder,
emails, hosts and IPs; `--hide-names` for names), shows exactly what it will
post, a new thread or a "+1" on the one there, and sends nothing unless you say
yes. `ork feedback export` and `import` move feedback as JSON lines.
