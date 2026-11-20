# A worked example: a project with its own process

_Part of [Projects: in your repository, or beside it](../projects.md)._

Say a backend project keeps its agents in `.ai/agents` (a documenter, an
implementer, a reviewer), names branches `<type>/<slug>` with a worktree each
beside the clone, and lets a human commit. Moving that process into Ork, without
writing into the repository:

1. Register it, then write rules in `~/.ork/projects/<id>/project.yaml`:

   ```sh
   ork register
   ```

   ```yaml
   schemaVersion: 1
   git:
     commit: never
     base: origin/main
     worktrees: "../{clone}-worktrees/{inputs.type}-{inputs.slug}-{node}"
   permissions:
     allow:
       [Read, Glob, Grep, Write, Edit, "Bash(git status*)", "Bash(git diff*)"]
     deny: ["Bash(git push *)"]
   defaults:
     {
       model: claude-code.haiku,
       driver: claude-code,
       budgetUsd: 0.6,
       maxTurns: 30,
     }
   ```

2. Draft a workflow from the agents:

   ```sh
   ork migrate --from-agents documenter,implementer --reviewer reviewer
   ```

   Then edit the draft: inputs `type` and `slug` instead of `branch`
   (`switch -c {{inputs.type}}/{{inputs.slug}}`), and a run budget.

3. Run it in the background:

   ```sh
   ork run process --input task="…" --input type=docs --input slug="…" \
     --input message="docs: …" --detach
   ```

   Then answer its questions with `ork decide`: a permission the rules do not
   cover, the gate before the reviewer, and the commit.

The run cost a few cents on haiku. The reviewer read the implementer's worktree,
the second gate showed the staged summary, and the commit landed on the new
branch; the clone's own checkout stayed as it was. Two things it taught:

- Permission patterns are Claude Code's: `Bash(git diff*)` does not match
  `git -C <path> diff`, so that call was asked about.
- Drafts chain the agents in one worktree (`isolation: continue`), so each sees
  the earlier edits.

To keep the repository's own agents out of the other nodes' sessions, and Ork's
words out of its files, see
[keeping a session to its step](../agents.md#keeping-a-session-to-its-step) and
[keeping Ork out of your repository's knowledge](./attached-projects.md#keeping-ork-out-of-your-repositorys-knowledge).

For the full rules: [projects](../../../specs/projects.md).
