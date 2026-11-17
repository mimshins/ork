# Skills and context

Each agent node's session is put together from **layers**: your own skills and
notes, your project's, the workflow's, and the node's. The more local layer
wins, and nothing is loaded twice. This guide shows where each layer lives and
how to check what a node gets.

## The layers

From lowest to highest precedence:

| Layer        | Where it comes from                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **You**      | skills in `~/.ork/skills/`, notes (`.md` files) in `~/.ork/context/`                                                                 |
| **Project**  | your repository's `CLAUDE.md` or `AGENTS.md`, `.claude/skills`, `.claude/agents`                                                     |
| **Workflow** | the workflow's `layers.skills` and `layers.context`, and its [lessons](./feedback.md#turning-one-into-a-lesson) (up to 1,500 tokens) |
| **Node**     | the node's own `skills`, `context` and `instructions`                                                                                |

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
    type: agent.worker
    skills: [./skills/threat-model] # this node only
    context: [./context/security-notes.md]
    instructions: Flag anything that handles user input.
```

- Paths start with `./` or `../` and are relative to the **workflow file**, so a
  workflow and its skills move together. They must stay inside the project.
- A skill is a folder with a `SKILL.md`. Its name is the `name` in that file's
  front matter, or else the folder's name.
- Project skills load on their own; you never list them here.

Every skill Ork adds to a session, its own (`ork:review` for reviewers,
`ork:brief` for leaders that delegate, `ork:report` for any node) or one your
workflow lists, is named `ork:<name>`, so it never clashes with your project's.
A skill's full text loads only when the session uses it. These are not Ork's
skills for Claude Code, from [the Claude Code guide](./claude-code.md).

`ork validate` reports a path that resolves to nothing, with its line, and
`ork run` will not start until it is fixed.

## Built-in practices

Two practices are on for every agent node unless you turn them off:

- **caveman**: a terse voice in chat, reports and messages between nodes, which
  saves tokens. Files, code, commits and questions to you stay in normal prose.
- **ponytail**: the smallest complete change; reuse before writing, no
  abstraction nobody asked for. `lite` and `ultra` make it gentler or stricter.

```yaml
defaults:
  practices: { caveman: false } # off for the whole workflow
nodes:
  planner:
    type: agent.leader
    practices: { ponytail: ultra } # this node and everything it owns
```

A node takes its own setting, else its agent's, else its nearest owner's, else
the workflow's `defaults`, else the `defaults` in `.ork/project.yaml`. Each
practice falls through on its own, so turning `caveman` off for a project stays
off in a workflow that only sets `ponytail`. When your project already has a
skill named `caveman` or `ponytail`, the project's wins and Ork adds nothing.

## See what a node loads

With a project that has a `CLAUDE.md` and two skills, `review` and `deploy`, and
a workflow that allows only `review` and adds a skill and a context file:

```sh
ork context explain .ork/workflows/review.ork.yaml security
```

```
security (agent.worker) in review

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

In `ork ui`, the **Context** panel shows the same for the node you choose, and
follows the Builder as you edit
([panels](./browser-view/panels-and-workspace.md#the-panels)).

## Reading part of a file: `extract`

What a tool returns stays in the conversation and is read again every turn.
Every session gets an `extract` tool, loaded from the first turn, that returns
only the part asked for; Ork's notes tell nodes to read through it. A program is
one to six steps: a step that produces text, then cuts of the text before them.
A call runs one program (`steps`) or up to eight (`programs`, each result under
its own header), so several files or searches cost one turn.

| Step           | What it does                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `read`         | A file's lines `from` to `to` (1-based, inclusive), each with its number                                    |
| `files`        | The folder's files, tracked and untracked, not ignored; a `glob` such as `**/*.test.ts` narrows them        |
| `search`       | A `pattern` (POSIX extended regex) in a file or folder; up to `maxMatches` hits, 50 unless set              |
| `git`          | `diff` (with `base`, `staged` or `path`), `show` (a `ref`) or `log` (up to 50 commits); no patches in `log` |
| `head`, `tail` | The first or last `lines` lines of the text before it                                                       |
| `match`        | The lines holding a literal `text` (a POSIX regex with `regex: true`), with `context` lines around each     |
| `count`        | How many lines the text before it has                                                                       |

For example, the lines of a diff that mention `harness`, with three lines around
each:

```json
{
  "steps": [
    { "step": "git", "op": "diff", "base": "main" },
    { "step": "match", "text": "harness", "context": 3 }
  ]
}
```

- **Only your folder.** A path that leads outside the session's folder, by `..`,
  an absolute path or a symlink, is refused, as is Ork's own session folder. The
  tool runs no shell: `git` is run directly with fixed options, 10 seconds at
  most.
- **Secret-looking files are refused.** `.env*`, `*.pem`, `*.key`, `id_rsa*`,
  `.npmrc`, anything under `.git/` (it is reachable only through the `git`
  step), a file a `Read(...)` rule in the node's `tools.deny` names, and one the
  project's `.claude/settings.json` or `settings.local.json` denies with a
  `Read(...)` rule. In a `git diff` or `show`, a refused file's section reads
  `[refused: <path>]`. If one of those settings files cannot be parsed, every
  path is refused and the tool says why. Your user-level Claude Code settings
  are not read.
- **Size.** A result is at most 16,000 characters. When it is cut, it says
  where, and to add a `head`, `tail` or `match` step, or to call again with
  `from` (a character of the result to start at): the steps run again each time,
  and nothing is stored. A binary file, or one over 8 MiB, is refused by `read`.
- **A footer**, `[extract: read N characters, returned M]`, ends every result;
  `pnpm benchmark` counts from it
  ([carried weight](../../benchmarks/method.md#carried-weight)).

## Order, and why it saves tokens

What Ork adds goes at the end of Claude Code's system prompt, shared parts
first: practices, your context, the workflow's context and lessons, Ork's own
notes on the node's role, then the node's context. The brief comes last, as the
first message. Nodes that share a workflow share the start of their prompt, so
the prompt cache covers it.

For the full rules: [context, skills and precedence](../../specs/context.md).
