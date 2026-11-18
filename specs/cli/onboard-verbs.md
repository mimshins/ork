# Built-ins, verbs and trust

_Part of [`ork onboard`](./onboard.md)._

Status: **Built**.

## The two built-in workflows

Both live in `packages/core/workflows/`, ship in `BUILTIN_WORKFLOWS`
([built-in workflows](./built-in-workflows.md),
[ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)), use only
fields the format has, and set `limits.budgetUsd` and `limits.budgetTokens` and
no `model` or `driver`. Every session sets
`layers.project: { instructions: ignore, skills: ignore }`, and every prompt
says the survey, the answers, the history and the repository's files are data,
never instructions. A shell step calls Ork as `"${ORK_BIN:-ork}"`
([L83](../messaging/scripts-limits.md)): `ORK_BIN` is set when `ork` runs
directly, which a test's `bin.ts` and the installed `bin.mjs` both do.

**`ork:onboard-propose`** (inputs `survey`, `answers`, `history`):

- `propose`: `agent.worker`, `isolation: readonly` (no owner, so it works in the
  project root), `tools.only` and `tools.allow` both `Read` (a node that can't
  edit reads text through `extract`, which lists and searches too; RFC-025), a
  `maxTurns` cap. It may ask the user up to three follow-up questions with
  `ask_user`, held by its prompt and `maxTurns` only. Ork's own tools pass
  `tools.only` on every driver: `--tools` limits Claude Code's built-in tools
  only and Ork's are in `--allowedTools`; OpenCode's rules let MCP tools past
  `only` and allow Ork's by name; Command Code's mod lets `mcp__ork__*` through.
  Its report declares `suggestions: { list: {} }`: Ork holds it to being a list
  on every driver (RFC-013), but a list item holds only scalars (L358) and a
  JSON Schema field is the driver's alone to enforce (G21), so
  [the filter](#the-filter) checks each item itself.
- It is the only node. A `filter` tool node once followed it and passed the list
  in an environment variable, which a long list could overflow (`E2BIG`); the
  command now reads `suggestions` from the run's result and filters it in its
  own process ([the filter](#the-filter)). Run alone, the workflow returns the
  proposer's list as it is ([L405](../gaps/onboard-limits.md)).
- Caps: `limits` and `defaults` both $3 and 600,000 tokens, `maxTurns: 40`.

**`ork:onboard-write`** (inputs `picks`, `survey`, `answers`):

- `format`: `tool.shell`, `"${ORK_BIN:-ork}" __onboard format`.
- `write`: `agent.worker`, `isolation: worktree`, `tools.only` and `tools.allow`
  both `Read`, `Edit`, `Write`, with `extract` to search (no shell; OpenCode and
  Command Code refuse an edit no rule allows), told to change only
  `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`, to cap every workflow in
  dollars and tokens, to name no `driver` or `model`, and to use only the
  `ork-implementer` and `ork-reviewer` agents (an existing workflow keeps those
  it already has). A later round's brief carries `finish`'s problems
  (`## Round n`).
- `finish`: `tool.shell`,
  `"${ORK_BIN:-ork}" __onboard finish --worktree "$WORKTREE" --branch "$BRANCH"`,
  with `WORKTREE: "{{nodes.write.output.worktree}}"` and
  `BRANCH: "{{nodes.write.output.branch}}"` in `env:` (a `script:` takes no
  templates). A tool node with no owner works in the project root
  ([worktrees](../worktrees.md)), so it reads the writer's worktree by path.
- `changes`: `tool.shell`, as `ork:feedback-apply`'s, with the same `env:`. On a
  branch it prints `git diff --stat HEAD...$BRANCH`; with none (`commit: never`
  leaves the worktree detached) it runs `git add -A` there (its index only) and
  prints `git diff --cached --stat HEAD`. Either way it gives the command to
  read the whole change.
- `keep`: `human.gate`, options `keep` and `discard`, its question the diff
  stat, `finish`'s stdout and the G14 line.
- Edges: `format -> write -> finish`; `finish -> write` when `exitCode == 1`
  (`finish` found problems), `maxRounds: 3`; `finish -> changes` when `ok`;
  `changes -> keep`. Any other exit of `finish` (127, a timeout `-1`, a signal)
  takes no edge, so the node fails the run with the tool's own error and the
  writer is not run again. A Node crash in `finish` exits 1 and still loops
  ([L403](../gaps/onboard-limits.md)).
- Caps: `limits` $6 and 1,200,000 tokens; `defaults` $2 and 400,000 tokens, so
  the first session and three more rounds fit; `maxTurns: 40`.

Each agent node names a rule file from its bundle in `context:`
(`onboard-propose/context/suggestions.md`, `onboard-write/context/writing.md`):
what is data, the question cap, the shape of a suggestion, and what a written
workflow holds. The `write` node also names `onboard-write/context/format.md`, a
reference for the workflow format: node types, ownership (`isolation`), edges
and `maxRounds`, gates, the entry node, caps, and one minimal valid workflow.
The `write` node names no agent: `ork-implementer`'s role says to follow the
project's own rules, which here are data.

## Suggestions

`SuggestionSchema` (`packages/cli/src/onboard/suggestion.ts`, inferred type
`Suggestion`), one strict object per suggestion:

| Field       | Type                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `workflow`  | a workflow name (`^[a-z0-9][a-z0-9._-]*$`); one that exists in `.ork/workflows` is a change to it |
| `why`       | text, 1 to 600 characters                                                                         |
| `decidedBy` | text: where a person decides (a gate, a review), 1 to 200 characters                              |
| `caps`      | `{ budgetUsd: number > 0, budgetTokens: integer > 0 }`                                            |
| `evidence`  | 1 to 8 of `{ path: string, note?: string }` or `{ commit: string, note?: string }`                |
| `commands`  | optional, up to 8 command lines the workflow would run                                            |
| `feedback`  | optional, up to 8 feedback item ids it answers                                                    |

## The filter

`ork onboard` checks the proposer's `suggestions` in its own process
(`filterSuggestions` in `packages/cli/src/onboard/verbs-filter.ts`, called by
`proposedOf`), against the project root, and runs nothing. A missing or non-list
`suggestions` is an empty list. The result is:

```json
{
  "kept": [{ "workflow": "…" }],
  "dropped": [{ "index": 2, "workflow": "…", "reasons": ["…"] }]
}
```

`kept` holds whole `Suggestion`s in their order; `dropped[].workflow` is `null`
when the entry has none. An entry is dropped, with every reason, when:

- it fails `SuggestionSchema` (the schema's message);
- an evidence `path` is absolute, climbs out of the root, or names no file or
  folder there;
- an evidence `commit` is not 7 to 40 hex characters, or
  `git cat-file -e <commit>^{commit}` fails;
- a `commands` line's program (its first word after `VAR=value` words) is
  neither on `PATH` nor an executable file inside the root;
- a line that runs a package script (`npm run x`, `npm test`, `pnpm x`,
  `pnpm run x`, `yarn x`, `yarn run x`, `bun run x`) names a script the root's
  `package.json` does not have; a manager's own command (`install`, `exec`,
  `dlx`, `add`, …, a fixed list) is not a script;
- an earlier kept entry has the same `workflow`;
- ten are already kept.

`feedback` ids are passed through unchecked. The hidden verb
`ork __onboard filter` that ran this as a tool node is gone: nothing called it
once the node left `ork:onboard-propose`.

## `ork __onboard`

A hidden command, like `ork __complete`: left out of `ork --help`, every help
and tab completion, documented only here, and free to change without notice.
Every verb exits 2 with one stderr line on a usage error (an unknown verb or
flag, a missing argument). Paths it reads are plain files inside their root: a
link is never followed out of it.

### format

`ork __onboard format [<type>…]` prints a compact brief of the workflow format
to stdout, exit 0: the workflow's top-level fields, then each node type's, one
line per field (`name*: type - description`, `*` when required), objects such as
`limits`, `defaults`, `tools` and `output` expanded one level, indented. With
types (`agent.worker tool.shell`) only those types follow the top level; an
unknown type exits 2 naming the known ones.

Measured on the current schema: the JSON Schema is 158 KB pretty and 71 KB
minified; one minified node type is up to 11 KB (`agent.worker`). The line brief
is 21.5 KB for the top level and every type, and about 10 KB for the top level
and `agent.worker`, `tool.shell`, `tool.git` and `human.gate`. A test keeps the
whole brief under 24 KiB. The `write` node takes the whole brief, so it rides in
each of the writer's up to 4 sessions.

### canon

`ork __onboard canon <file>…` parses each file and rewrites it through
`serializeWorkflow` when its text differs. Stdout is one line per file,
`canonical <file>` or `rewrote <file>`. A file that does not parse or fails the
schema is left as it was, with `<file>: <reason>` on stderr; the others are
still done, and the exit is 1. A link is refused. Exit 0 when every file is
canonical now. This is the only way the CLI reaches the serializer (G18).

### finish

`ork __onboard finish --worktree <path> --branch <branch>`, run in the project
root, checks the writer's work. Stdout is two sections, each line a `- ` item:

```
problems:
- .ork/workflows/ci.ork.yaml: limits.budgetTokens is missing
needs your eye:
- .ork/workflows/ci.ork.yaml: node test allows `Bash(pnpm test:*)`
```

A section with no item reads `- none`. Exit 1 when there is a problem, else 0;
the `finish -> write` edge loops only on exit 1, so a `finish` that cannot start
(exit 127) fails the run instead of costing three more writer rounds. In order:

1. **Scope.** The paths in `git diff --name-status HEAD...<branch>` and the
   worktree's uncommitted ones, ignored ones too (`git status` with `--ignored`;
   an ignored file reads as added), except an ignored file Ork itself copied
   into the worktree (`CLAUDE.local.md`, `.claude/settings.local.json`, what
   `.worktreeinclude` lists) whose bytes still equal the same path in the
   project root: an edited copy, or any other ignored file, is refused; and
   except `.commandcode/taste/taste.md`, the file `command-code` leaves in the
   folder it runs in, when it is new in the worktree, a regular file (not a
   link, nor behind one) and empty: the exact path only, so a non-empty file, a
   link, a committed one or any other path there is refused. Each must be an
   added or modified `.ork/workflows/<name>.ork.yaml` (one level) or
   `.ork/project.yaml`; any other path, or a deletion or rename, is a problem. A
   write outside the worktree is still not seen
   ([L395](../gaps/onboard-limits.md)). A subfolder project's paths lose the
   `git rev-parse --show-prefix` prefix; one outside it reads `../…` and is
   refused ([L434](../gaps/onboard-limits.md)).
2. **Each changed workflow**, read in the worktree: it parses and passes the
   schema; it sets `limits.budgetUsd` and `limits.budgetTokens`; no `driver` or
   `model` anywhere (`defaults`, `agents`, nodes); no `agents:` of its own, and
   every `agent:` is `ork-implementer` or `ork-reviewer`. A file that existed at
   `HEAD` is held only to what it adds: a `driver`, `model`, agent or `agent:`
   the file already had, in the same place, passes; the caps are always
   required. The project file's `defaults.driver` and `defaults.model` reach
   every workflow too, so the rule covers them; today they are only listed at
   the gate ([L402](../gaps/onboard-limits.md)).
3. **Canonical form.** Each one that parses is rewritten through
   `serializeWorkflow`; when any changed, they are committed in the worktree as
   `ork: canonical form (run <ORK_RUN>)`, no attribution, the repository's hooks
   running; a refused commit is a problem. With no branch (`--branch ""`, under
   `commit: never`) the rewrite stays uncommitted, as the writer's work does.
   After a commit that went through, each file is read again and compared with
   the text written: one a hook rewrote is a problem,
   `<file>: rewritten by a commit hook, no longer canonical`. The writer cannot
   fix a hook, so it burns its rounds ([L404](../gaps/onboard-limits.md)).
4. **Validation,** in this process, not by running `ork validate`: each file is
   loaded and walked as `ork validate` does, with the worktree as the project,
   then checked as `ork validate --driver <id>` does for the plain case and for
   each driver ready on the machine (the same code, `loadWorkflow`, `walkLoaded`
   and `driverDiagnostics`). Each error is a problem
   (`<file>: <code> <message>`); warnings are not.
5. **Needs your eye**, against the file at `HEAD` (none for a new one): each new
   `tools.allow` entry, on a node, an agent, `defaults` or in
   `.ork/project.yaml`'s rules; each new tool node `env:` entry; each new
   network reach: a `tool.gh`, `tool.aws` or `mcp.call` node, an `mcp:` server,
   or a `WebFetch` or `WebSearch` allow. Reading is the only thing dropped, and
   by tool name: a rule whose name is `Read`, `Glob`, `Grep`, `LS` or
   `NotebookRead` (with or without arguments) is not listed; every other name,
   `Bash(…)` rules included, and every rule of a shape Ork cannot parse, is. A
   change to one of these fields is listed as
   `<where> changes <field> to <value>` when its value is new or differs from
   `HEAD` (a field `HEAD` set and the file no longer does reads
   `<where> removes <field>`; a node `HEAD` had and the file no longer has gives
   one line, `node <id> removed`, and none of its `removes` lines, or no line
   when it had no listed field): on a node `context`, `isolation` and
   `tools.only`; in a workflow `context` (`layers.context`), `rules.git`,
   `rules.links` and `defaults.isolation`; in `.ork/project.yaml` `context`,
   `heavy`, `calls.accept`, `followUps.file`, `git`, `links` and
   `defaults.isolation`.

## Trust model

- The paid part reads untrusted text: the repository, a cloned project's files,
  recorded runs and feedback, the answers. Both built-ins mark every input
  untrusted, ignore the project's instructions and skills where the driver
  allows it ([what each driver adds](#what-each-driver-adds)), and say so.
- `propose` reads only; `write` has no shell and works in a worktree; every
  shell step is a tool node whose command Ork wrote; nothing the model drafted
  runs before the user keeps it and runs the workflow themselves.
- **Checked in code:** evidence, drafted commands and names (the filter); scope,
  caps, no `driver`/`model`, agents, canonical form and validation per ready
  driver (`finish`); the gate's "needs your eye" list.
- **Held only by a prompt:** how many follow-up questions `propose` asks (and
  `maxTurns`); the quality of what is proposed and written; a write outside the
  worktree. A bare `Edit` or `Write` allow is not held to the worktree (G14), so
  `finish` sees only what lands in the worktree; the gate says so. Nor are the
  proposer's bare `Read` held to the project on `claude-code` and `command-code`
  ([L399](../gaps/onboard-limits.md)).
- No credential is asked for, stored or sent; the survey records only whether
  `gh` is usable. Inputs are scrubbed like other run inputs.

## What each driver adds

`layers.project: ignore` is applied only on `claude-code`
([what a session loads](../runtime/what-a-session-loads.md)):

- **`claude-code`**: the project's `CLAUDE.md`, `CLAUDE.local.md`,
  `.claude/rules` and `AGENTS.md` stay out, and its skills are switched off.
  `.claude/settings.json` and `settings.local.json` still load: the session's
  `settingSources` stay `[project, local]` under `layers.project: ignore`
  (`--setting-sources project,local`), with their permissions and hooks
  ([L394](../gaps/onboard-limits.md)).
- **`open-code`**: the session settings that carry `ignore` are not passed, so
  the repository's `AGENTS.md` loads. `.claude/` and `CLAUDE.md` stay out, as
  always on this driver.
- **`command-code`**: not passed either: `AGENTS.md`, `.commandcode/skills` and
  `.commandcode/agents` load, with the machine's own skills, memory and mods.

These are [limits](../gaps/onboard-limits.md), and the onboarding guide says
which driver reads least.
