# ADR-078 — `read_input`: a sent-back input too long for its message

- **Status:** Accepted
- **Date:** 2026-11-10
- **Topic:** runtime port, Ork's tools
- **RFC:** waived — the maintainer decided this directly after build run
  `d67e4060`

## Context

When a loop sends a node back, its message carries what the workflow sent it
with, such as three reviewers' findings, in a `## Round n` section cut at 8 KiB.
In build run `d67e4060` the three findings went past that, so the leader never
saw the end of one reviewer's list, and said so in its report. Nothing recorded
the cut: it was not in the specs or the gaps.

## Decision

The section still shows the input's first 8 KiB, so the message stays small.
When that cuts it, the section says how much there is, and the session gets
`read_input(from?)`, one of Ork's own MCP tools: it returns the whole input
32,000 characters a call, with where the next page starts. The node's executor
hands the whole input to the session on a new `SessionPorts.input`; the tool is
offered only when that is set, and it reads nothing else.

## Options considered

- **Write the input to a file in the run's folder.** A session works in its own
  worktree and can't read the run's folder without a permission prompt, and that
  folder also holds program output not yet scrubbed; each driver would need its
  own way to grant one folder.
- **Raise the cut to 64 KiB.** One constant, but every re-entry may then carry
  up to 64 KiB of prompt, and a larger input is still cut.

## Consequences

- Every driver gets it the same way, through Ork's MCP server, with no file
  access and no prompt.
- Nothing is lost past 8 KiB; the model decides whether to read the rest, and
  the message tells it to before it acts.
- `SessionPorts` gains an optional field; drivers that ignore it are unchanged.
