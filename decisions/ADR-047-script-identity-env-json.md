# ADR-047 — Tool nodes know who they are, take an environment, and return JSON

- **Status:** Accepted
- **Date:** 2026-11-04
- **Topic:** workflow format / node executors / CLI
- **RFC:** waived by the author; the options are below
- **Builds on:** [ADR-022](./ADR-022-integration-registry.md) (tool nodes),
  [ADR-034](./ADR-034-tool-git.md) (a tool node's output fields)

## Context

Ork should spend model turns on judgment, not on parsing or couriering. A tool
node's result could not steer a run, because `stdout` is capped text and a
`when:` had only `exitCode` and `contains(stdout, …)`. Reading one field of
`gh pr view --json` took an agent. A program could be handed `{{run.id}}` as an
argument but not its own node id, and the format spec promised `env:` references
that did not exist (C10).

## Decision

**Identity.** Every program a tool node runs gets `ORK_RUN`, `ORK_NODE`,
`ORK_ROUND`, `ORK_RUN_DIR`, `ORK_PROJECT`, `ORK_WORKFLOW` and, when `ork` can be
run directly, `ORK_BIN`, over the environment it inherits. A nested `ork run`
drops the outer run's before giving its own. Claude sessions get none of these,
only `ORK_SESSION=1`, which says no more than that it is a session.

**`env:` on tool nodes.** Values are templates. Only these values may read the
user's variables, as `{{env.NAME}}`, because a rendered `command` is recorded in
`tool.called`. A variable that is not set stops `ork run` before anything
starts; one a called workflow reads only warns, since that call may never run.
Events record key names, never values, and values read from `{{env.*}}` of eight
characters or more are scrubbed from what every tool node prints or returns, in
any form a JSON encoder writes them and in JSON keys and numbers, by a plain
search of the text as written and with its escapes decoded, so a value of any
size takes time in step with the text. Each line of a multi-line value and each
value in a JSON one are masked too. That covers what the workflow reads, what
the workflows it calls by name read, and what its callers read, told to a called
run as names in `ORK_MASKED`. A node's `plainEnv` lists variables it reads that
are not secret, which stay unmasked unless another node reads them without
listing them. `ORK_*` keys are refused.

**`output: { format: json }`.** It declares that the program returns JSON, read
as `output.json`. The file at `$ORK_OUTPUT` wins when the program wrote one;
otherwise all of stdout is parsed. A program that exits 0 with invalid or empty
JSON, or a bad file, fails the node. A result over 64 KiB once serialized fails
and is kept in a run file; it is never cut. A parse error does not quote the
text. The file lives in the run's private `.output` folder and is removed once
read, and a run clears that folder when it starts, resumes and ends, so after a
clean run the scrubbed value is the only copy
([L85](../specs/messaging/scripts-limits.md)).

**`ork chat`, `ork continue` and answering with `ork decide` refuse when
`ORK_RUN` or `ORK_SESSION` is set,** and `ork ui` withholds its sign-in link,
since they act as the user, and a program or an agent in a run must not. Listing
decisions and `ork stop` stay open.

## Options considered

- **Stdout only.** Works for `gh` and `aws` with no wrapper, but a script could
  not log to stdout. Kept, as the default.
- **`$ORK_OUTPUT` only, like `$GITHUB_OUTPUT`.** Keeps stdout for logs, but
  needs a script around every CLI. Both are built, by the author's choice.
- **A bad file falls back to stdout.** Would hide a broken script behind
  whatever it logged, so it fails instead.
- **Merge the file over stdout, or refuse both.** Harder to reason about, or
  breaks a script that always writes the file.
- **A `fromJson()` expression function.** No format change, but it runs on
  capped text, breaks at 64 KiB, and templates read only paths.
- **Merge JSON fields straight into `output`.** Shorter, but a program could
  shadow `exitCode`, and a value that is not an object has no home.
- **Mask only names that look secret, or only values marked secret.** No format
  addition or nothing masked by mistake, but a missed name or mark stores the
  secret. Masking everything fails safe, so `plainEnv` is the exception, at the
  cost of a small format addition.
- **A clean environment for programs.** Would break `gh`, `aws` and `PATH`; Ork
  keeps inheriting, as the user's own tools expect.

## Consequences

- A workflow can branch on a CLI's JSON with no model turn.
- `$ORK_OUTPUT` needs the same declaration as stdout: a node without
  `output: { format: json }` gets no file, so a read of `output.json` can be
  checked at compile time.
- Identity is attribution. A program runs as the same user with the same store,
  so it can unset these; the guard stops accidents and a prompt-injected "run
  ork chat", and is not a boundary
  ([L80](../specs/messaging/scripts-limits.md)).
- `packages/cli/src/bin.ts` is now executable, so `ORK_BIN` works from source.
