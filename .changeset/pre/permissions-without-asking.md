---
"@krapht/ork": patch
---

On `claude-code`, a shell line is read through loops, subshells and wrappers and
allowed without a question when the node's rules or Ork's shipped reads
(`ork logs`, `jq`, `head`, …) cover every command. A read-only node is refused,
with a message, a command its rules do not allow; `unlisted: ask` on a node, a
workflow's `rules.permissions` or the project's `permissions` brings the prompt
back. A permission for a readable line also offers allow for this node, this run
or always, and "always" adds the rule to `permissions.allow` of the project's
rules file, keeping its comments. A rule allowed 3 times across 2 runs is filed
as a `permission.suggest` feedback item. The Codex, Command Code and omp guards
read loops and subshells with the same reader.
