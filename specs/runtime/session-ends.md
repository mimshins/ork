# How a session ends

_Part of [Runtime: the agent drivers](../runtime.md)._

Status: **Built.** The closed set of end kinds, its registry, `SessionEnd`,
`endFor` and the legacy readers are in core
([ends.ts](../../packages/core/src/runtime/ends.ts),
[ends-legacy.ts](../../packages/core/src/runtime/ends-legacy.ts),
[outcome.ts](../../packages/core/src/runtime/outcome.ts),
[tests](../../packages/core/test/ends.test.ts)). The provider classifier
([provider-errors.ts](../../packages/runtime/src/provider-errors.ts)) and each
adapter's decoder set `SessionOutcome.end`; Claude, tool, MCP and call nodes,
timeouts and interrupts set `NodeResult.end`; `node.finished` records it;
feedback files by its actor; the CLI, the server (`EndView`) and the browser
view show it; and [why a node stopped](../../docs/guides/why-a-node-stopped.md)
lists every kind (a core test fails when a kind has no section there). Why a
closed set: [ADR-079](../../decisions/ADR-079-closed-set-of-end-kinds.md). What
is left is in [the register](../gaps/end-kinds-limits.md) (L241 and L243 to
L248). The token cap of RFC-015 ends `budget_limit` too
([below](#the-token-cap)).

## The kinds

Every way a node can end, on every driver and node type, is one kind of
`END_KIND_IDS` (`EndKind`). Adding a kind without its `END_KINDS` entry fails
the typecheck and a test.

| Kind                   | Actor    | Transient | Means                                                                                                             |
| ---------------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `done`                 | none     | no        | Reported pass, done or changes requested                                                                          |
| `reported_failure`     | agent    | no        | The agent reported `fail`                                                                                         |
| `no_report`            | agent    | no        | Ended without handing in a report                                                                                 |
| `invalid_report`       | agent    | no        | Its report broke the node's declared output                                                                       |
| `turn_limit`           | workflow | no        | Reached `maxTurns`                                                                                                |
| `budget_limit`         | workflow | no        | Reached its or the run's `budgetUsd` or `budgetTokens`, or none was left                                          |
| `timed_out`            | workflow | no        | Reached its `timeout`                                                                                             |
| `context_too_long`     | workflow | no        | The conversation outgrew the model's context                                                                      |
| `plan_limit`           | account  | yes       | A subscription window is used up (stops the run, RFC-007)                                                         |
| `rate_limited`         | provider | yes       | The provider asked to slow down (429)                                                                             |
| `provider_unavailable` | provider | yes       | Overloaded, 5xx, or the network failed                                                                            |
| `auth`                 | account  | no        | Not signed in, or the key was refused                                                                             |
| `out_of_credits`       | account  | no        | The account has no credit left                                                                                    |
| `model_unavailable`    | account  | no        | The model or provider can't serve this request                                                                    |
| `interrupted`          | user     | no        | Stopped by the user                                                                                               |
| `tool_missing`         | account  | no        | The driver's or tool node's program isn't installed                                                               |
| `command_failed`       | workflow | no        | A tool node's command exited non-zero                                                                             |
| `invalid_output`       | workflow | no        | A tool node's JSON broke its declared output                                                                      |
| `invalid_node`         | workflow | no        | The node could not start: its settings, an MCP server it names, a `forEach` list or a `watch` condition was wrong |
| `driver_crashed`       | ork      | no        | The driver's process ended in a way Ork can't read                                                                |
| `unknown`              | ork      | no        | Nothing matched; files an Ork bug with the detail                                                                 |

## Who maps what

Adapters decide what only they can see; anything else with error text goes
through the shared provider classifier, which reads an error's type or code,
then its HTTP status, then its words, so a changed sentence rarely changes the
kind. A decoder never leaves `end` unset, and `unknown` is the last resort.

| Driver         | Signal                                         | Kind                                                          |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `claude-code`  | `error_max_turns`, `error_max_budget_usd`      | `turn_limit`, `budget_limit`                                  |
|                | counted tokens reach `budgetTokens`            | `budget_limit` (Ork stops it, below)                          |
|                | `error_max_structured_output_retries`          | `invalid_report`                                              |
|                | any other error result                         | the classifier, else `unknown`                                |
| `command-code` | exit 8, 5, 10, 130                             | `turn_limit`, `rate_limited`, `out_of_credits`, `interrupted` |
|                | exit 3 and 4                                   | `auth`                                                        |
|                | exit 6, 7 and 9                                | `provider_unavailable`                                        |
|                | any other exit or `error`                      | the classifier, else `unknown`                                |
| `open-code`    | every `steps` step used and no report          | `turn_limit` (closes L239)                                    |
|                | an `error` line (name, status, body); exit 130 | the classifier; `interrupted`                                 |
| every driver   | counted tokens reach `budgetTokens`            | `budget_limit` (Ork stops it, below)                          |
|                | the program is not installed (`ENOENT`)        | `tool_missing`                                                |
|                | a start that failed with a provider's words    | the classifier                                                |
|                | any other failure to run                       | `driver_crashed`                                              |

A `claude-code` session that hands in its report (`StructuredOutput`, accepted)
and then writes on can end with a result that carries no `structured_output`.
The adapter's leg decoder keeps the last accepted call's input and gives it to
such a result, so the session ends with that report, not `no_report`; a call
`claude` refused is not kept, and a result's own report wins.

Node types that run no driver set their own ends, in the node's own code, with
Ork's message and the program's (or server's) own text, scrubbed and capped, as
the detail:

| Node            | Signal                                                                      | Kind                                      |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `tool.*`        | exit 0                                                                      | `done`                                    |
|                 | the run was aborted (stop, or a timeout's signal)                           | `interrupted`                             |
|                 | exit -1 with `ENOENT` in stderr (a program that would not spawn)            | `tool_missing`                            |
|                 | the integration's `signedOut` says its sign-in is gone                      | `auth`                                    |
|                 | any other non-zero exit                                                     | `command_failed`                          |
|                 | JSON that does not parse or breaks the node's `output`                      | `invalid_output`                          |
|                 | a command that can't be built (its own definition is wrong)                 | `invalid_node`                            |
| `mcp.call`      | an unreadable or unknown server, an `env` or `{{ }}` that can't be rendered | `invalid_node`                            |
|                 | the server refused its sign-in (401, `UnauthorizedError`)                   | `auth`                                    |
|                 | the server's program is not installed (`ENOENT`)                            | `tool_missing`                            |
|                 | any other thrown error, or a result the tool marked as an error             | `command_failed`                          |
|                 | a result over 64 KiB, or JSON that breaks the node's `output`               | `invalid_output`                          |
| `workflow.call` | the called run's own end, carried up                                        | that kind                                 |
|                 | the called run ended `plan_limit`, or was refused at its start by a limit   | `plan_limit`, read as refused (`limited`) |
|                 | the run has no call port (it can't call workflows)                          | `invalid_node`                            |
| `human.gate`    | no one answered before its `timeout`                                        | `timed_out`                               |
|                 | the gate was withdrawn                                                      | `interrupted`                             |

A tool node's end is `transient` only when its kind is, by the registry. The
`Integration.signedOut` hook
([integration.ts](../../packages/integrations/src/integration.ts)) is how an
integration says a failed command was a missing sign-in, so the node ends `auth`
(not signed in) and not `command_failed`: `gh` says it by exit code 4 or by
`gh auth login` in stderr, `aws` by stderr naming missing or expired credentials
(`Unable to locate credentials`, `ExpiredToken`, an expired SSO session,
`aws sso login`). A tool without the hook only ever fails with `command_failed`.

The scheduler ends nodes too, in its own code
([execute.ts](../../packages/core/src/run/execute.ts)): a node's own `timeout`
is `timed_out`, an abort comes before any other end (`interrupted`), and a run's
`limits.timeout` that expires ends the nodes still running `timed_out`. A node
that could not start is `invalid_node`, whose sources are a `watch.until` that
does not read, a `forEach` list that can't be built, an over-`maxItems` list no
one let run (declined, or asked with no one to answer), a checkout that can't be
made (a branch rule), an `mcp.call` or tool node's own definition, and a
`workflow.call` in a run that can't call workflows. A graph with no node or no
executor for a type is Ork's own bug, so `unknown`.

The classifier and the mappings are tested with fixtures that follow the
providers' documented error formats (Anthropic, OpenAI-style, the `commandcode`
provider and OpenCode's own errors, including L240's two), and with a
[contract-suite](../../packages/runtime/test/contract/contract.test.ts) case per
cause on every driver ([L244](../gaps/end-kinds-limits.md)).

Each `END_KINDS` entry (`EndKindInfo`) holds a `label` (the badge), `message`
(Ork's sentence from `EndFacts`, without the node's name: "reached its turn
limit (8)"), `actor` (`null` for `done`), `transient`, `stopsRun` (only
`plan_limit`), `hint` (what to do; a transient kind's says it may pass and that
`ork resume` tries again) and `docsAnchor` (its section of
`docs/guides/why-a-node-stopped.md`, `END_DOCS`).

## The end

`SessionEnd` is `{ kind, message, detail? }`. The message is Ork's own and never
quotes the provider. The detail is the raw provider or tool text:
`endFor(kind, facts?, detail?, scrub?)` masks its secrets (and, given the
project's roots and home, runs the feedback redactor) and caps it at
`END_DETAIL_LIMIT` (4096 characters) before anything stores it.

- A tool's stderr is the workflow's own program, not the provider, so for
  `command_failed` the CLI shows the last non-empty line of the detail (cut to
  200 characters) under the headline without `--verbose`; every other kind keeps
  its detail behind `--verbose` ([the terminal](../cli/running-and-runs.md)).
- `SessionOutcome.end`: how the session ended. `subtype` stays one release for
  stored events and is no longer read for decisions.
- `NodeResult.end`: how the node ended; `error` is its message.
- `node.finished.end`: the result's end, as `finishedEvent` records it.

When several signals arrive, the first of these wins: interrupt, plan limit,
budget, timeout, turn limit, provider error, report problems, crash, unknown. A
run-level stop ends the nodes still running: the run's `limits.timeout` as
`timed_out`, and a stop by the user as `interrupted`. The run's own status and
reason name the limit as well.

## The token cap

RFC-015, [ADR-084](../../decisions/ADR-084-budgets-and-quotas-in-tokens.md).
Every driver can be capped in tokens, whether or not it reports a price. The
shared session runner
([session-leg.ts](../../packages/runtime/src/session-leg.ts),
[session-end.ts](../../packages/runtime/src/session-end.ts)) keeps the session's
counted tokens (input, output and cache write, never cache reads, its earlier
legs' included) and checks them at each per-request usage report the driver's
decoder hands it. Once they reach (`>=`) the node's `budgetTokens`, the runner
sends the process SIGINT, ignores whatever it prints after, and ends the session
`budget_limit` with the subtype `error_max_budget_tokens` and a message such as
`reached its budget ($100, 300 tokens)`, naming the caps the node had. The end
kind is the existing one, so no new kind joins the closed set
([ADR-079](../../decisions/ADR-079-closed-set-of-end-kinds.md)). A report the
session already handed in through Ork's `report` tool still decides its end.

A tool can't be stopped between its reports, so a session can pass the cap by up
to one report:

| Driver         | Checked at                                       | Can pass the cap by                                                       |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `claude-code`  | each `assistant` message's usage, per message id | one model response; its output count may lag a little; result lines exact |
| `open-code`    | each `step_finish`                               | one step                                                                  |
| `command-code` | each `model_request_end`                         | one model request                                                         |

None of the three prints a cost mid-session, so a session stopped at its token
cap records $0 and a run's dollar limit under-counts it
([L280](../gaps/budget-tokens-limits.md)). Claude Code's own `--max-budget-usd`
stays, so on `claude-code` both caps bind. Stand-in sessions in
[the contract tests](../../packages/runtime/test/contract/contract.test.ts)
cover each driver.

## Runs from before

A stored event is never rewritten. `endOf(finished)` returns a `node.finished`
event's (or a result's) `end`; without one, `done` when it succeeded, and
otherwise a kind read from its `error` text, with that text as the detail. A
failed output with `artifacts` came from a session's report, so it is
`invalid_report` when the text is a declared-output problem and
`reported_failure` otherwise, whatever the agent wrote. Ended without a report,
the subtype decides (`error_max_turns`, `error_max_budget_usd`), then the
session's error text, then `no_report`; other text is matched in the order
above, and nothing matching is `unknown`. `outcomeEnd(outcome)` does the same
for a stored `session.finished` outcome. These patterns are frozen to the text
Ork stored, so they are not the live provider classifier.
