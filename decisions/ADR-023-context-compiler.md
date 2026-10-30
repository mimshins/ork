# ADR-023 — How the context compiler hands layers to Claude Code

- **Status:** Accepted
- **Date:** 2026-10-30
- **Topic:** engine / context
- **RFC:** waived — slice 4 of the M1c task spec; the author approved the layer
  model, and the mechanisms below follow from what Claude Code supports

## Context

[specs/context.md](../specs/context.md) defines five layers of skills and
context, more local winning, nothing loaded twice. It left three mechanisms
open: how Ork's skills reach a session, how a project skill is hidden when a
higher layer shadows it or the workflow leaves it out, and how `AGENTS.md` is
handled. The spec said Ork would append `AGENTS.md` itself when a repository had
no `CLAUDE.md`.

Since then Claude Code reads `AGENTS.md` itself: when there is no `CLAUDE.md`
from v2.1.277, and in every session type from v2.1.281
([memory docs](https://code.claude.com/docs/en/memory)). Plugin skills are
namespaced `plugin:skill`, and the `skillOverrides` setting can switch a skill
`off`, hiding it from the model and refusing its invocation
([skills docs](https://code.claude.com/docs/en/skills)).

## Decision

1. **Ork's skills go through one plugin per node**, named `ork`, written to
   `.ork/runs/<run>/plugins/<node>/` and passed as SDK `plugins` or CLI
   `--plugin-dir`. The session sees them as `ork:<name>`. Only the winner of
   each name is copied in.
2. **Project skills are switched off, not copied**: one shadowed by a higher
   layer, or left out by `project.skills`, gets
   `skillOverrides: { <name>: "off" }` in the session's extra settings (SDK
   `settings`, CLI `--settings`). Checked against Claude Code 2.1.314 with its
   `initialize` response (no model call): `{"review": "off"}` removes the
   project's `review` and keeps the plugin's `ork:review`. It also hides a
   bundled skill whose alias is the same name (`/code-review` via `/review`);
   the spec says so.
3. **`AGENTS.md` is Claude Code's**: Ork never appends it, which could load it
   twice; `ork doctor` warns when `claude` is older than 2.1.281.
   `project.instructions: ignore` uses `claudeMdExcludes` for the checkout's
   `CLAUDE.md`, `CLAUDE.local.md` and `.claude/rules`, and sets the built-in
   AGENTS.md plugin to `claude-md`.
4. **References** are `ork:<name>` for a built-in or `./` paths relative to the
   workflow file, kept inside the project; built-ins load only where named, at
   that layer. Unresolved ones are `ref.skill` / `ref.context` errors in
   `ork validate` and stop `ork run`.
5. **Context files are appended** to the system prompt, shared before specific:
   practices, user context, workflow context and lessons, Ork's harness, then
   the node's context.

Code: [packages/core/src/context/](../packages/core/src/context/resolve.ts),
[plan.ts](../packages/core/src/run/plan.ts); `ork context explain`:
[context.ts](../packages/cli/src/commands/context.ts).

## Options considered

- **Shadowing:** `skillOverrides` (chosen); `Skill(name)` deny rules (block the
  call but keep the skill listed, costing tokens); the SDK's `skills` allowlist
  (SDK only, and it hides bundled skills too).
- **Ork's skills:** a plugin (chosen, namespaced, no collisions); copying them
  into the checkout's `.claude/skills` (writes into the user's tree and would
  show up in git); `--add-dir` (loads that folder's CLAUDE.md as well).
- **AGENTS.md:** leave it to Claude Code (chosen); append it when there is no
  CLAUDE.md, as the spec said (now loads it twice on current Claude Code).
- **Reference base:** the workflow file's folder (chosen; a workflow and its
  skills move together); the project root.

## Rationale

Every mechanism is one Claude Code documents for both drivers, so the session
loads the same way whichever runs it, and Ork writes nothing into the user's
checkout. Leaving `AGENTS.md` to Claude Code follows the rule that nothing is
loaded twice.

## Consequences

- `ork doctor` gains a version warning; older `claude` installs may not read
  `AGENTS.md`.
- A shadowed project skill can hide a bundled alias of the same name.
- Ork ships no built-in skills yet; `BUILTIN_SKILLS` is the registry when it
  does.
