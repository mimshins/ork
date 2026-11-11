# Limits found building the `agent.*` types and driver-prefixed models

_Part of [Known gaps and limits](../gaps.md)._

Status: **Open**: to decide at the next review, as the register's other entries.

Found building RFC-015 part 1 (the `agent.*` node types and `<driver>.<model>`,
[ADR-083](../../decisions/ADR-083-agent-node-types-and-driver-prefixed-models.md)).
What was left simpler:

- **L273 · `ork migrate` rewrites only the project's workflows folder.** It
  scans the `*.ork.yaml` files in the project's workflows folder
  (`.ork/workflows/`), not `examples/` or a workflow given by path, and it
  rewrites no agent or trigger file. Run `ork validate <file>` on those: it
  names the new type, and the file is edited by hand
  ([migrating](../projects.md#migrating)).
- **L274 · `open-code` and `command-code` have `subagents: false` unmeasured.**
  The descriptors say neither runs subagents, so an `agent.subagent` under their
  leader is refused; nobody has tried whether either tool could
  ([drivers](../runtime/which-driver.md#sub-agents)). Measure on a real session
  and flip the capability.
- **L275 · A prefix in a written item value is caught at run.** A `forEach`
  item's `model` written in the file (`claude-code.opus`) is checked for its
  driver when the item runs, not when `ork validate` compiles it; a rendered
  `{{item.model}}` always was. A sub-agent's own `driver` is not compared with
  its leader's, only its model's prefix is.
- **L276 · TypeScript identifiers keep the old name.** `isClaudeNode`,
  `claudeExecutor` and `packages/nodes/src/claude.ts` still say `claude` though
  they serve every agent node. A rename touches many files for no change in
  behaviour.
- **L277 · A default driver quietly gives way to a prefixed default model.**
  With `defaults: { driver: open-code, model: claude-code.sonnet }`,
  `ork validate` passes and every node runs on `claude-code`; the Builder flags
  the clash, the compiler does not. A node's own `driver` is checked.
