---
"@krapht/ork": minor
---

New: `ork link`. Make `.ork/agents` and `.ork/skills` the one place your agents
and skills live, and point `.claude/agents`, `.opencode/skills` and the other
tools' folders at them. It links the tools your project already uses (or the
ones you name), never replaces a real folder or a link you made, and `--check`
shows each folder's state. `ork init` links the same way (`--no-link` to skip),
and `ork doctor` reports missing or broken links.
