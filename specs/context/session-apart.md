# Keeping a session apart from a project's own agent process

_Part of [Context, skills and precedence](../context.md)._

Status: **Built**: the session text, the `quiet` practice, and the mapping of an
attached project's context references
([harness.ts](../../packages/core/src/run/harness.ts),
[quiet.ts](../../packages/core/src/practices/quiet.ts),
[files.ts](../../packages/core/src/context/files.ts); tests:
[harness](../../packages/core/test/harness.test.ts),
[practices](../../packages/core/test/practices.test.ts),
[context](../../packages/core/test/context.test.ts)). Why:
[ADR-110](../../decisions/ADR-110-keep-ork-sessions-apart.md).

A repository can run its own agent process (a documenter, an implementer, human
review, a reviewer), and its contributors' agents read its `CLAUDE.md` or
`AGENTS.md`. Ork runs those steps as other nodes, so a session must stay in its
own step and write nothing about Ork where those contributors read. Three parts
of the context hold that, and
[two rules](../project-rules/agents-and-knowledge.md) and
[a write limit](../runtime/write-limit.md) beside them.

## Session text

Ork's harness instructions (`harnessInstructions`, under `# Ork`, before the
node's own instructions) carry four lines on every node's session, with no
setting and no wording about the repository's docs, so they hold in any project:

- the session is one node of an Ork workflow: it does only its node's step, and
  the next step is another node;
- it never starts another step's role agent (a documenter, an implementer, a
  reviewer or a PR shepherd) itself, as a sub-agent or otherwise; only the
  sub-agent nodes it owns are its to start;
- human gates (a review of the diff, an approval, the choice to commit or open a
  pull request) are not its to wait for, ask for or treat as done;
- it never stages, commits, pushes or posts (a pull request, a comment, a
  review) unless its brief or these instructions say the node does.

The line on blocked decisions now reads "Ask with `ask_user`". Claude Code's own
question prompt, `AskUserQuestion`, is withheld on every reading rule, `extract`
and `open` alike (`ASKING_TOOLS`, a list apart from the `Grep` and `Glob` it
sits beside in `tool-rules.ts`): a headless session cannot answer it, and asks
through `ask_user`. It rides in every driver's deny list, and a driver without
that tool ignores it. A node that names it in its own `tools.allow` or
`tools.only` keeps it, as for `Grep` and `Glob`
([withheld tools](../runtime/extract-tool.md#withheld-tools)).

## The `quiet` practice

A built-in practice, on by default for every agent node, resolved like `caveman`
and `ponytail` ([cascade](../context.md#built-in-practices)):
`practices: { quiet: false }` on `defaults` or on a node, its agent or its owner
turns it off. Its text comes after `caveman` and `ponytail` in the appended
system prompt ([quiet.ts](../../packages/core/src/practices/quiet.ts)). It tells
the session never to write about Ork (its workflows, nodes, gates, runs,
sessions, tools or follow-ups) into any file of the repository, any commit
message, pull request title or body, review comment or reply, or code comment,
to write what it learns as the repository would, in terms of no tool, and to
keep Ork's own notes in `.ork/`. Where the checkout has a skill named `quiet`,
the project's wins and Ork adds nothing, as for the other two.

A project that wants its Ork sessions to write about Ork (Ork's own repository)
sets `defaults.practices.quiet: false`.

## Context files in an attached project

A project registered from outside its repository keeps its Ork folder in
`~/.ork/projects/<id>/`
([projects](../projects.md#an-attached-projects-workflows)). Context references
there follow one extra rule, so the same text works in both modes:

- A reference resolves as it does in an in-repo project: against the workflow
  file's folder, so a workflow in `~/.ork/projects/<id>/workflows/` is resolved
  as if it sat in `<root>/.ork/workflows/`, and the project's own `context` list
  against the project root.
- A resolved path **inside `<root>/.ork/`** reads the same relative path in
  `~/.ork/projects/<id>/`. `context: [.ork/context/a.md]` in `project.yaml`, and
  `../context/a.md` from an attached workflow, both load
  `~/.ork/projects/<id>/context/a.md`. A path outside `.ork/` still resolves in
  the repository, as before; an in-repo project is unchanged.
- The file must be a plain file inside that folder (`plainPathInside`, as for
  lessons). A link, a path behind a link, or a path that leaves the folder is
  refused with a `ref.context` error that names the folder searched, so a cloned
  repository cannot aim a reference at another file of the person's. A missing
  file's error names the folder too:
  `<ref> does not exist in ~/.ork/projects/<id>`.
- The file's name in `ork context explain` stays the `.ork/…` form it was
  written in, so moving the files with `ork migrate` leaves its output as it
  was. A watch of the reference's path still points at `<root>/.ork/` for them
  ([L523](../gaps/session-apart-limits.md)).

`ork validate`, `ork context explain` and a real run read the same way
(`contextFiles` in `files.ts`, given the project's Ork folder).
