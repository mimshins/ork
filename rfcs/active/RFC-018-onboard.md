# RFC-018 — `ork onboard`: a forward-deployed engineer built into Ork

- **Status:** Accepted
- **Date:** 2026-11-13
- **Supersedes:** —
- **Superseded by:** —

## Context

A new user installs Ork and gets an empty `.ork/`. What helps them from there:

- **`ork init`** writes one starter workflow, the same for every project
  (`starterWorkflow` in `packages/cli/src/project/init.ts`), and with `--issues`
  one more template (`packages/cli/src/commands/setup.ts`).
- **`/ork:setup` and `/ork:write`** guide an agent through setup and writing a
  workflow (`plugins/ork/skills/`). They reach only a person whose agent loads
  Ork's skills, and they run in that agent's own session: no cap, no record, and
  a result that differs by tool (`docs/getting-started/with-your-agent.md`).

Nothing looks at the user's codebase and how they ship, and says which workflows
would help. That is the job of a forward-deployed engineer: read the project,
ask what hurts, propose, build, and come back later to improve it. Ork's own
workflows (`.ork/workflows/`: `start`, `rfc`, `plan`, `build`, `qa-pass`) came
from that kind of work, done by hand over weeks.

Facts that bear on the options, read from the code:

- **Ork already ships a workflow inside itself.** `ork:<name>` resolves to a
  text in the package, written under the project's gitignored run folder by its
  content's hash, so a run resumed after an upgrade reads the text it started
  with (`packages/core/src/project/builtin-files.ts`). There is one,
  `ork:feedback-apply` (`packages/core/workflows/feedback-apply.ork.yaml`), and
  a command wraps it: `ork feedback apply` (`packages/cli/src/runs/apply.ts`,
  [ADR-059](../../decisions/ADR-059-closing-the-feedback-loop.md)). It treats
  what it reads as untrusted: its worker has no shell (`tools.only`), works in a
  worktree, and ends at a gate that shows the diff. Ork never merges it.
- **A project needs no workflow for a run to pick an agent tool.** A session
  takes `--driver`, or else the driver ready on the machine
  (`specs/runtime/which-driver.md`), and a committed workflow names none.
- **Ork's question tool works on all three drivers** (`docs/guides/drivers.md`,
  "What each driver does"). It offers two to four options
  (`packages/runtime/src/tools/ask-user.ts`), and a gate's options are written
  in the workflow file (`packages/schema/src/nodes.ts`). Neither can ask "which
  of these N suggestions": nothing in a run picks several.
- **Permissions differ by driver.** `claude-code` asks when a tool isn't
  allowed, which stalls a run until someone answers (G29). `open-code` and
  `command-code` refuse instead (`docs/guides/drivers.md`, "Permissions"). A
  node limited to reading tools meets neither.
- **A session that reaches its turn limit hands in nothing** (G30). A run's
  nodes each keep their result, and `ork resume` goes on from the last one.
- **`ork validate` proves a file compiles, not that it fits the project.** It
  walks only the inputs' defaults (G11) and cannot know that `pnpm test` exists.
  `ork validate --driver <id>` checks a workflow against one driver. The `check`
  and `workflow_format` tools belong to `ork mcp` (`specs/cli/mcp.md`), not to a
  run's sessions.
- **A session reads the repository as instructions.** It loads `CLAUDE.md` or
  `AGENTS.md` and the project's skills
  (`specs/runtime/what-a-session-loads.md`), unless the workflow's
  `layers.project` says `ignore` (`specs/context.md`, "How a node's session is
  compiled", which describes it for Claude Code). What this feature writes is
  workflows and allow lists: text that runs again and again.
- **A worktree is not a wall.** A bare `Edit` or `Write` allow isn't held to the
  node's worktree (G14).
- **Dollars are not everywhere.** `command-code` reports tokens only, so a
  `budgetUsd` can't see its sessions; `ork:feedback-apply` sets only dollar
  caps. Model names don't carry over either: OpenCode's `--model` needs
  `provider/model` (L236).
- **Ork records what a later visit would read**, with no model: system signals
  from the event store (`specs/feedback/capture.md`), cost and its hints
  (`specs/usage.md`), feedback items and follow-ups.
- **"Integration" is taken.** It means merging work into a shared branch
  (`specs/integration.md`), and `ork-integrations` is the driver package. The
  working name `ork integrate` would collide.

Not measured: what a run of this would cost, or how good its suggestions are. No
number in this RFC is a measurement.

## Options

### Option A — One long session

`ork onboard` starts one session on the chosen driver with a built-in prompt. It
explores, asks as it goes, writes the workflows and validates them.

- **Pros:** closest to a conversation; the least to build.
- **Cons:**
  - A stop at the turn limit, a crash or a spent budget loses everything paid
    for (G30); there is one cap for the whole job.
  - Exploring and validating need a shell in the session, so the run stalls on
    `claude-code` (G29) and is refused on the other two, or its allow list grows
    wide in a session that is reading untrusted files.
  - Everything it read rides along through every question, which is the
    transcript cost Ork's design avoids (`docs/how-ork-works.md`).

### Option B — A command that wraps built-in workflows

The command does itself what needs no model: the machine check, the driver
choice, a survey of the repository, fixed questions, picking among suggestions.
Between those it runs workflows shipped inside Ork, as `ork feedback apply`
does: read-only exploring and proposing, then writing the picks in a worktree, a
validation loop, and a keep-or-discard gate.

- **Pros:**
  - Each step keeps its result and has its own cap; a failed run resumes.
  - Sessions that read the repository have reading tools only, so they neither
    stall nor get refused, on any driver.
  - Shell work runs as tool nodes whose commands Ork wrote, not the model.
  - It follows a pattern Ork has shipped, with its trust model.
- **Cons:**
  - More to build: two built-in workflows, a survey, a way to pick several in
    the terminal (`packages/cli/src/term/` has `select` and `confirm` only).
  - Less of a conversation: questions come at set points.
  - Built-in workflows must work on three drivers and stay true to the format as
    it changes.

### Option C — No paid command: a free survey, and skills for the user's agent

`ork init` gains the survey and writes `.ork/project.yaml` and templates from
`examples/`. The engineer is delivered as skills: `/ork:setup` and `/ork:write`
read the survey and do the rest in the user's own agent, checking with
`ork mcp`.

- **Pros:** nothing new to pay for or cap; a small change.
- **Cons:** it reaches only an agent that loads Ork's skills; no cap, no record
  and no resume; quality differs by tool; templates alone are what `ork init`
  already offers, one size for every project.

## Decision

**Option B, named `ork onboard`.** Decided by the maintainer on 2026-11-13, with
the points below.

1. **The command owns the free steps.**
   - It runs `ork doctor`'s checks, and `ork init`'s file steps when the project
     has no `.ork/`.
   - It picks the driver: the one ready on the machine; a `select` when several
     are; how to log in, and a stop, when none is. `--driver` skips the
     question. No session is spent on it.
   - It surveys the repository with no model: package manager and scripts, test
     and check commands, CI files, the base branch, whether `gh` is usable,
     agent and skill folders, any `.ork/` already there.
   - It asks a few fixed questions (what slows you down, what you ship, how a
     change is reviewed) and passes the answers in as inputs.
   - It shows the most the paid part can spend (the sum of its caps, in dollars
     and tokens) and starts only on a yes.
2. **Two built-in workflows run on the chosen driver.**
   - **Propose** reads the survey, the answers and the repository with reading
     tools only, and returns suggestions as structured output. Each names the
     workflow, why this project needs it, where the person decides, its caps,
     and the files or commits that are its evidence. A tool node then checks
     that every cited file and commit exists, and drops a suggestion whose
     evidence doesn't.
   - The command shows the suggestions, and the user picks any number. That step
     is free and in the terminal, because a run has no way to pick several.
   - **Write** authors the picks in a worktree, under `.ork/` only. A tool node
     runs `ork validate` on each file, and `ork validate --driver` for every
     driver ready on the machine, and sends problems back until they pass or the
     rounds run out. It ends at a gate that shows the diff and every new allow
     rule, `env` entry and network tool. Kept, the branch is the user's to
     merge; Ork never merges it.
3. **The interview is fixed questions, then bounded follow-ups.** After the
   fixed questions, the proposing session may ask the user a small, capped
   number of questions of its own through Ork's question tool.
4. **Suggestions are checked, not only argued.** Evidence is verified as above.
   A drafted tool command is checked by what can be known without running it:
   its program is on `PATH`, its package script exists. Nothing the model
   drafted runs before the user has kept it.
5. **What the repository says is data.** The built-in workflows' sessions don't
   load the project's instructions or skills as their own; they read those files
   as part of the survey. Their prompts say so, as `ork:feedback-apply`'s does.
6. **It returns.** Run in a project that has workflows and runs, the survey adds
   what Ork recorded, with no model: per workflow, how its runs ended, what they
   cost, their hints, open feedback items and follow-ups. The questions ask what
   went wrong lately, and a suggestion may change an existing workflow as well
   as add one. The path is the same: propose, pick, write in a worktree, gate.
7. **Caps in dollars and in tokens,** on the built-in workflows and on every
   workflow they write, so a `command-code` run is held too.
8. **Written workflows name no driver,** as `ork init`'s starter doesn't.

## Consequences

- **Positive:**
  - A new user gets workflows fitted to their project, on whichever of the three
    tools they have, with a cap and a record.
  - The engineer comes back: the same command reviews what the runs showed.
  - The survey and the fixed questions are useful with no spend.
- **Negative:**
  - Built-in workflows become a surface to keep working on three drivers and
    through format changes. A second and third join `ork:feedback-apply`.
  - Its quality is the chosen model's. Ork can check evidence and form, not
    judgment.
  - Two features share one command, onboarding and review. If the review grows,
    it may want its own name.
  - `/ork:setup` and `ork init` overlap with it and must point at it or stay
    clearly smaller.
- **To build:**
  - the command, the survey and the history digest, in `packages/cli`;
  - the two workflows in `packages/core/workflows/` and their entries in
    `BUILTIN_WORKFLOWS`;
  - a pick-several prompt in `packages/cli/src/term/`;
  - tests with the three fake drivers.
- **Specs and docs in the same change:**
  - a spec for the command, with its trust model, and its row in `specs/cli.md`;
  - `specs/projects.md`, where it meets `ork init`;
  - the getting-started guides and the README's "Get started";
  - `plugins/ork/skills/setup`;
  - the interaction map and the roadmap.
- **Records:** an ADR when it ships; a changeset (a new command); gap entries
  for what is left out or held only by a prompt.
- **After it ships:** a paid trial on Ork itself and on two or three other
  repositories, on each driver, to see what it costs and whether its suggestions
  hold. Those are the first measurements; this RFC has none.

## Open questions

- **Attached projects** (`ork register`). Their `.ork` lives outside the
  repository (`specs/projects.md`), so there is no branch to review, and
  `ork init` refuses them. Refuse here too, or write into the attached folder
  with a diff shown another way? People trying Ork before committing to it are a
  likely audience.
- **A repository with no commit** has no worktree. Stop with what to do, as
  `ork doctor` does, or offer the first commit?
- **Is the project layer really off on every driver?** `layers.project: ignore`
  is described for Claude Code (`specs/context.md`). Command Code still loads
  the user's own skills, memory and MCP servers (`docs/guides/drivers.md`, "What
  stays out of a session"). What holds on `open-code` and `command-code` must be
  checked before point 5 can be promised there.
- **Holding the writer to `.ork/`.** A check on the worktree's diff catches a
  file changed elsewhere in the worktree. It does not catch a write outside the
  worktree (G14). Is a prompt rule plus that check enough for a first version,
  or does G14 need closing first?
- **What `model` do written workflows carry?** `sonnet` and `opus` are Claude
  Code's names; OpenCode wants `provider/model` (L236). Name none and take each
  tool's default, or ask the user per driver? The same goes for the built-in
  workflows, whose quality is the model's.
- **How the follow-up questions are capped.** No setting limits how many
  questions a node asks. Hold it by the prompt and the turn limit, or add a cap
  to the format (its own change)?
- **May written workflows use `ork-implementer` and `ork-reviewer`?** They are
  the lowest layer of the agent catalog and change with Ork
  (`packages/core/src/agents/builtins.ts`). Or should the writer put the
  project's own agents under `.ork/agents/`?
- **Where the format knowledge comes from.** The writer's prompt, `/ork:write`
  and the JSON Schema would say the same thing three times, and no command
  writes a workflow in canonical form (G18). Should the writer get the schema
  from a tool node's output, and its files be passed through the serializer by a
  tool node?
- **Does declining the paid part leave anything written?** The survey could
  write `.ork/project.yaml` (base branch, allow rules for the project's own
  check commands, `heavy`) with no model. Offer that as a free ending, or only
  print what it found?
- **Review and `ork feedback apply`.** When a kept change answers open feedback
  items, does the command mark them resolved, as `ork feedback apply` does for
  one?
- **One name for both jobs.** Does a later visit run as `ork onboard` again,
  choosing review by what the project holds, or behind a flag?
- **No terminal.** The command asks questions. Refuse without one, or take the
  answers and the picks as flags?
