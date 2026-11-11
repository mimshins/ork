---
"@krapht/ork": minor
---

Breaking: the agent node types are renamed `claude.worker` → `agent.worker`,
`claude.leader` → `agent.leader` and `claude.subagent` → `agent.subagent`, and
the old names are refused by `ork validate` and `ork run`. Run `ork migrate` in
each project to rewrite your workflows (`--dry-run` shows the changes first);
`model` values are left as they are. A `model` may now start with its driver,
`<driver>.<model>` (`claude-code.opus`,
`open-code.anthropic/claude-sonnet-5-5`): it pins that node to the driver, ahead
of `ork run --driver`, and `ork validate` refuses a prefix that contradicts the
node's `driver`. Plain models such as `deepseek/deepseek-v4.1-flash` still work.
A driver now says whether it runs subagents, and an `agent.subagent` under a
leader on one that doesn't is refused. Affected packages: the CLI bundles the
rest, so only `@krapht/ork` is released.
