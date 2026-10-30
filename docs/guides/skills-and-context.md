# Skills and context

Each Claude node's session is put together from **layers**: your own skills and
notes, your project's, the workflow's, and the node's. The more local layer
wins, and nothing is loaded twice. This guide shows where each layer lives and
how to check what a node gets; the contract is the
[context spec](../../specs/context.md).

## The layers

From lowest to highest precedence:

| Layer        | Where it comes from                                                                   |
| ------------ | ------------------------------------------------------------------------------------- |
| **You**      | skills in `~/.ork/skills/`, notes (`.md` files) in `~/.ork/context/`                  |
| **Project**  | your repository's `CLAUDE.md` or `AGENTS.md`, `.claude/skills`, `.claude/agents`      |
| **Workflow** | the workflow's `layers.skills` and `layers.context`, and `.ork/lessons/<workflow>.md` |
| **Node**     | the node's own `skills`, `context` and `instructions`                                 |

When two layers have a skill with the same name, only the higher one loads. A
node's own skill beats the workflow's, the workflow's beats the project's, and
the project's beats yours.

Your Claude Code user settings (`~/.claude`) are never loaded: a run behaves the
same on any machine with the same repository. Put what you want in every run in
`~/.ork/` instead.

## Your project, as Claude Code sees it

Ork lets Claude Code load the project layer itself, from the node's checkout, so
your repository works the way it does when you run `claude` there: `CLAUDE.md`
(or `AGENTS.md` when there is no `CLAUDE.md`), rules, skills and agents.

You can narrow it per workflow:

```yaml
layers:
  project:
    instructions: inherit # or ignore: leave out CLAUDE.md, AGENTS.md and rules
    skills: inherit # or ignore, or { allow: [review, deploy] }
```

A project skill that is ignored, not allowed, or beaten by a higher layer is
switched off for that session: it is neither listed nor usable.

> Switching off a project skill named `review` also hides Claude Code's own
> `/code-review`, whose short name is `review`.

## Adding skills and context to a workflow

```yaml
layers:
  skills:
    - ./skills/review-checklist # a folder with a SKILL.md
  context:
    - ./context/house-style.md # appended to every node's system prompt
nodes:
  security:
    type: claude.worker
    skills: [./skills/threat-model] # this node only
    context: [./context/security-notes.md]
    instructions: Flag anything that handles user input.
```

- Paths start with `./` or `../` and are relative to the **workflow file**, so a
  workflow and its skills move together. They must stay inside the project.
- A skill is a folder with a `SKILL.md`. Its name is the `name` in that file's
  front matter, or else the folder's name.
- Ork's own built-in skills will be named `ork:<name>`; none ship yet.
- Project skills load on their own; you never list them here.

The session sees the skills Ork adds as `ork:<name>`, so they never clash with
the project's. A skill's full text loads only when the session uses it.

`ork validate` reports a path that resolves to nothing, with its line, and
`ork run` will not start until it is fixed.

## Built-in practices

Two practices are on for every Claude node unless you turn them off:

- **caveman**: a terse voice in chat, reports and messages between nodes, which
  saves tokens. Files, code, commits and questions to you stay in normal prose.
- **ponytail**: the smallest complete change; reuse before writing, no
  abstraction nobody asked for. `lite` and `ultra` make it gentler or stricter.

```yaml
defaults:
  practices: { caveman: false } # off for the whole workflow
nodes:
  planner:
    type: claude.leader
    practices: { ponytail: ultra } # this node and everything it owns
```

A node takes its own setting, else its nearest owner's, else the workflow's
`defaults`. When your project already has a skill named `caveman` or `ponytail`,
the project's wins and Ork adds nothing.

## See what a node loads

With a project that has a `CLAUDE.md` and two skills, `review` and `deploy`, and
a workflow that allows only `review` and adds a skill and a context file:

```sh
ork context explain .ork/workflows/review.ork.yaml security
```

```
security (claude.worker) in review

Instructions  CLAUDE.md, loaded by Claude Code

Skills
  − deploy                project   .claude/skills/deploy                   off: not in project.skills.allow
  ✓ review                project   .claude/skills/review                   ≈21 tokens when used
  ✓ ork:review-checklist  workflow  .ork/workflows/skills/review-checklist  ≈295 tokens when used

Context files
  workflow  .ork/workflows/context/house-style.md  ≈104 tokens

Practices
  caveman   ≈666 tokens
  ponytail  ≈612 tokens

Appended to Claude Code's system prompt: ≈1,527 tokens
```

It plans the session without running anything: which instructions load, every
skill with its layer and whether it is on, the context files, the practices, and
estimated tokens (about four characters each). Add `--json` for a script.

## Order, and why it saves tokens

What Ork adds goes at the end of Claude Code's system prompt, shared parts
first: practices, your context, the workflow's context and lessons, Ork's own
notes on the node's role, then the node's context. The brief comes last, as the
first message. Nodes that share a workflow share the start of their prompt, so
the prompt cache covers it.
