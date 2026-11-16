# ADR-097 — Built-in onboarding workflows and the hidden `ork __onboard` verbs

- **Status:** Accepted
- **Date:** 2026-11-16
- **Topic:** `ork onboard`, core built-in workflows, CLI
- **RFC:** [RFC-018](../rfcs/archived/RFC-018-onboard.md) (Option B)
- **Amends:** [ADR-059](./ADR-059-closing-the-feedback-loop.md)

## Context

A new user gets an empty `.ork/` and one starter workflow that is the same for
every project. [RFC-018](../rfcs/archived/RFC-018-onboard.md) weighed three
shapes for a forward-deployed engineer built into Ork and the maintainer
accepted Option B: a command that does the free steps itself and runs two
built-in workflows between them. This ADR records the parts that are hard to
reverse: two more built-ins that later ones will follow, and a hidden command
that two of their nodes run.

## Decision

1. **Two built-in workflows, `ork:onboard-propose` and `ork:onboard-write`**
   (sources in `packages/core/workflows/`, bundled as in
   [ADR-096](./ADR-096-built-in-bundles.md)). `propose` is one read-only session
   (`tools.only`: Read, Grep, Glob) and nothing else; `write` is a `format` tool
   node, a worktree writer with no shell, a `finish` tool node that loops back
   to the writer when it exits 1 (`when: exitCode == 1`, `maxRounds: 3`), a
   `changes` diff and a `keep` gate. The workflow format is unchanged.
   _Amended:_ `propose` first had a `filter` tool node after it, which passed
   the suggestions in an environment variable; a long list could overflow it
   (`E2BIG`), so `ork onboard` now filters the run's `suggestions` in its own
   process and the node is gone. The loop edge first read `when: "!ok"`, which
   also sent the writer back (and paid) when `finish` could not start.
2. **A hidden command, `ork __onboard <verb>`,** with `format`, `canon` and
   `finish` (a `filter` verb was part of it until the in-process filter, see the
   amendment above), left out of help and completion like `__complete`. The tool
   nodes run `"${ORK_BIN:-ork}" __onboard …`; a program Ork wrote checks what a
   model drafted, so the checks are code, not prompts: evidence, drafted
   commands and names (the filter, in `ork onboard`); scope, caps, no `driver`
   or `model`, agents, canonical form and validation under every ready driver
   (`finish`). The verbs validate in-process, not by spawning `ork validate`.
   `canon` is the one way the CLI reaches `serializeWorkflow` (G18 stays open
   for users).
3. **Caps, chosen by the maintainer:** `ork:onboard-propose` $3 and 600,000
   tokens; `ork:onboard-write` $6 and 1,200,000 tokens (its `defaults` are $2
   and 400,000 per session, so the first go and the three rounds fit). The
   command prints the sum, in dollars and in tokens, before any session and
   starts only on a yes. A `command-code` run is held by tokens, as it reports
   no dollars.
4. **Neither built-in nor anything they write names a `driver` or `model`,** and
   written workflows use `ork-implementer` and `ork-reviewer` only, with no
   `.ork/agents/` files: a committed workflow carries nobody's login, and a run
   takes the driver ready on the machine.
5. **Everything a session reads is data.** Both set `layers.project: ignore`,
   mark every input untrusted and say so. That setting reaches only the
   `claude-code` driver; the others still load `AGENTS.md` (L393) and Claude
   Code still loads the project's settings (L394). The writer may change only
   `.ork/workflows/*.ork.yaml` and `.ork/project.yaml`, held by `finish`'s diff
   check, not a sandbox (G14); the gate says so and lists every new allow rule,
   `env` entry and network tool call.
6. **Ork never merges.** A kept change stays on its branch, a discarded one is
   removed with its worktree; a failed write run keeps its branch for
   `ork resume`. A kept change lists the feedback ids it cited and resolves
   none.
7. **Left simpler, as gaps:** attached projects are refused (L390), the
   command's own steps between the two runs start over when interrupted (L391),
   the follow-up question cap is held by the prompt and `maxTurns` (L392).

## Consequences

- Two built-ins to keep working on three drivers and through format changes; the
  end-to-end tests run both on all three fake drivers, and `finish` validates
  under each ready driver, so format drift fails a run, not a user's file.
- A second hidden surface beside `__complete`, free to change without notice.
- The brief `format` prints is about 21.5 KB, under a 24 KiB test limit, in
  every write session's prompt.
- Reversible: no stored run, event or format change, and `schemaVersion` is
  unchanged. The shape of the hidden verbs and the two names are the
  hard-to-reverse part.

Spec: [`ork onboard`](../specs/cli/onboard.md),
[limits](../specs/gaps/onboard-limits.md).
