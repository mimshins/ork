---
"@krapht/ork": patch
---

Harden what a session and other local users can reach. The `command-code` driver
checks a shell line command by command (every one must be allowed; a
substitution or a redirect to a file needs a plain `Bash` rule) and checks reads
by their real path. `claude-code` sessions get Ork's token in private files, not
on the command line. `~/.ork` is kept 0700 and its database 0600. A reported
branch that isn't a plain branch name is dropped, and follow-ups scrub who they
are for, their ref and the draft's channel.
