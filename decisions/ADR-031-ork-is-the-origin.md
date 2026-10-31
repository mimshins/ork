# ADR-031 — `.ork/` is the origin; tool folders link to it

- **Status:** Accepted
- **Date:** 2026-10-31
- **Topic:** projects / agents and skills
- **RFC:** waived — the author chose to follow se-backend's own layout; the
  options are below

## Context

A project's agents and skills are read by several tools, each from its own
folder: Claude Code from `.claude/agents` and `.claude/skills`, OpenCode from
`.opencode/`, Agent Skills tools from `.agents/skills`. se-backend keeps one
copy in `.ai/` and links each tool's folder to it, so every tool reads the same
files. Ork reads all of these folders
([ADR-030](./ADR-030-agents-fill-nodes.md)) and writes its own, `.ork/agents`
and `.ork/skills`. An agent added with `ork agents add` should be visible to the
user's other tools too, without a second copy.

## Decision

1. **`.ork/` is the origin.** `.ork/agents` and `.ork/skills` hold the files;
   each tool's folder is a relative link to them
   (`.claude/agents → ../.ork/agents`). Links are per folder, not per tool:
   `.claude/` keeps everything else it holds.
2. **The tools come from the layout registry**
   ([layouts.ts](../packages/integrations/src/layouts.ts)): a new tool is one
   entry, not new code.
3. **Linking only creates.** `ork link [tools…]` makes a link where nothing is;
   a real folder, or a link to somewhere else (se-backend's `.ai/`), is reported
   and kept. A link whose origin is missing, as after a fresh clone, gets its
   origin back. An origin it creates holds a `.gitkeep`, so git keeps it and
   committed links never dangle.
4. **By default, only the tools a project already uses:** those whose top folder
   (`.claude`, `.opencode`, …) exists. Naming a tool links it even if it is new
   to the project. `ork init` does the same (`--no-link` to skip).
5. **`ork doctor` reports each tool's links** once a project has `.ork/`:
   linked, missing (fixed by `ork link`), broken, or kept as its own folder.

## Options considered

- **Link the whole tool folder** (`.claude → .ork`): one link, but `.claude/`
  also holds settings, commands and hooks that are not Ork's. Rejected.
- **Copy into each tool's folder:** works without symlinks, but the copies
  drift. Rejected.
- **Replace a real folder after moving its files into `.ork/`:** that is a
  migration, with its own command and confirmation (`ork migrate --agents`,
  planned), not something `ork link` does silently.
- **Link every known tool by default:** creates `.opencode/`, `.agents/` and
  `.ai/` in projects that use none of them. Rejected for the tools in use.

## Consequences

- An agent written to `.ork/agents` is read by Claude Code and OpenCode at once,
  and by Ork once (links are deduplicated by real path).
- A project that keeps its origin elsewhere, as se-backend does, is left as it
  is; `ork link --check` shows its links pointing at `.ai/`.
- Symlinks need `core.symlinks` on native Windows ([gaps](../specs/gaps.md)).
