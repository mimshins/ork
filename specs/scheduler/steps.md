# Steps around a session

_Part of [Scheduler: running a workflow](../scheduler.md)._

Status: **Built, proven on a real session on the CLI driver**; the SDK driver
only against stand-ins ([C5](../runtime.md#limits)).

A leader or worker can run a program in its own checkout, which a tool node
can't reach, and which a delegated child gets too, as it follows no edges.

## Contents

- [Checks on a report](#checks-on-a-report)
- [Before a session](#before-a-session)
- [MCP calls](#mcp-calls)

## Checks on a report

A leader's or worker's `verify:`
([RFC-006](../../rfcs/archived/RFC-006-steps-around-a-session.md),
[verify.ts](../../packages/nodes/src/verify.ts)) runs inside the node's
executor, after any late-message turn and before `workspace.finish` commits its
work, so within its `timeout`. It is the tool nodes' executor on a one-off
`tool.shell` node: the same identity, rendering, masking and caps, and its calls
show in the node's events.

- **When:** on a report that is not `fail` or `changes_requested`. `done`
  counts, so a session cannot report its way past a check.
- **On a failure:** the same session resumes with the reason, cut to 1 KiB, and
  the last 8 KiB of what it printed, past the 64 KiB a node's output keeps, with
  all of it in `<run>/<node>.<round>.verify-<try>.txt` when there is more (each
  try its own file, so a path a session was given keeps its text). It gives a
  new report, up to `attempts` times. A resume may use only what is left of the
  node's cap, the run's budget and `maxTurns`, counting from this activation,
  and does not start with nothing left, or while the node is paused. Then the
  node fails with `its check failed: <reason>`.
- **A message during a check that passes** gets one turn, and the check runs
  again, with its failures sent back as above. Later messages wait for the
  node's next session ([L96](../messaging/scripts-limits.md)).
- **A failed check stays failed:** a resume that reports `fail` or
  `changes_requested`, or nothing, ends it with no more checks, and the node
  fails. Only a report on which the check then passes is accepted.
- **A node stopped** before or during its check fails rather than passing
  unchecked, and runs again on `ork resume`.
- **Its result** is `output.verify`: `exitCode` and `resumes`. A node's
  `notify:` rules and edges read the checked result.
- **`ork run --node`** has no check, and says so.

## Before a session

`before:` ([claude.ts](../../packages/nodes/src/claude.ts)) runs first in the
node's executor, once its checkout exists, each time the node runs and for each
spawned instance. It runs as `verify:` does.

- **On a failure,** the node fails with `its before step failed: <reason>`, with
  what it printed in `output.before`, and no session starts. A node stopped
  during it starts none either, and a paused one waits.
- **Its result** is `before` in that node's `prompt`, and nowhere else, which
  the compiler enforces (`ref.before`): `exitCode`, `stdout`, `stderr`, and
  `json` with `output: { format: json }`. A resumed session keeps the prompt it
  started with.
- **`defaults:` may set it,** in a workflow or `.ork/project.yaml`, for every
  leader and worker with none of its own. It can't read a node's output, since
  it belongs to none ([L93](../messaging/scripts-limits.md)).
- **It isn't held to `isolation`,** on a `readonly` or `shared` node too
  ([L97](../messaging/scripts-limits.md)).
- **`ork run --node`** does not run it, and says so.

## MCP calls

`mcp.call` ([mcp-call.ts](../../packages/nodes/src/mcp-call.ts),
[mcp-servers.ts](../../packages/nodes/src/mcp-servers.ts)) is not a step but a
node: one tool on one server, with no session and no permission asked, as the
author named it.

- **The server** comes from `.mcp.json` at the project's root. Stdio and HTTP
  with static headers are called; `oauth` and SSE are refused, since Ork stores
  no tokens and those are Claude Code's. A 401 says so too.
- **Variables:** `${VAR}` and `${VAR:-default}` read the user's environment,
  over which the node's rendered `env:` lies. A stdio server inherits what a
  program does, without `ORK_*`. It starts per call, in the project's root.
- **Before a run:** `envProblems` refuses a run whose server is missing, can't
  be called, runs a program that isn't installed, or reads a variable that isn't
  set, so nothing is spent first. A value that isn't a string in its `args`,
  `env` or `headers` is refused too, rather than dropped.
- **Masking:** a run masks each value its workflow's servers read, in all it
  records, from any node; `plainEnv` excuses one. What the file holds as
  written, a default included, is not ([L81](../messaging/scripts-limits.md)).
  `arguments:` can't read `{{env.*}}`.
- **Output:** `text`, and `json` from `structuredContent` or text that parses,
  its numbers masked too. A result marked `isError` fails the node, and `json`
  over 64 KiB does too and is left out. The `error` is cut to 1 KiB.
- **Timeout:** the node's `timeout`, which lifts the SDK's own 60 seconds on
  starting the server as on the call.
