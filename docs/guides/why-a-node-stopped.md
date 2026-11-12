# Why a node stopped

Every node that ends, on every driver and every node type, ends as one of the
kinds below. Each has a plain message, someone who should act, and something to
do, and it reads the same in `ork run`, `ork logs`, the browser view and the
feedback Ork files. The kinds are a closed set, so a message you meet is one of
these.

## Reading it

A failed node's line in `ork run` and `ork logs` is its kind and Ork's own
sentence:

```text
build │ ✗ Turn limit: reached its turn limit (8)
```

A kind that may pass says so: `(may pass; ork resume retries)`. Ork never prints
the provider's or the program's own words first. They are kept, with secrets and
paths scrubbed and at most 4 KiB, as the end's **details**:

- `ork run --verbose` and `ork logs <run> --verbose` print each failed node's
  hint and details under its line.
- `ork logs <run> --node <id>` shows one node's events with the hint and details
  always on.
- In the browser view, the node's inspector and the Logs panel show the kind as
  a badge, the message, what to do and a **Details** button.

The run's own status (`failed`, `budget_exhausted`, `quota_exhausted`) stays as
it is; its reason uses the same messages. A run stored before kinds existed is
read back to a kind from its error text, and shows **Unknown** when nothing
matches. Ork never rewrites it.

Who acts is one of the agent, the workflow, your account, the provider, you or
Ork. Ork files feedback for the agent's, the workflow's and its own, never for
your account, the provider or you ([feedback](./feedback.md)).

## Done

The node reported `pass`, `done` or `changes requested`. Nobody acts.

## Reported failure

The agent reported `fail`: it did the work and says it could not finish. **Who
acts:** the agent, through its brief. **What to do:** read its summary, fix what
it names, run it again. Ork files no feedback, since this is its answer.

## No report

The agent's session ended without handing in a report. **Who acts:** the agent.
**What to do:** check the brief says what to report; its session is in the Logs
panel. Ork files a context gap.

## Invalid report

The report broke the node's declared `output.schema`, or the `report` tool
refused it. **Who acts:** the agent, not Ork. **What to do:** check the brief
asks for every field the schema declares.

## Turn limit

The node used all of its `maxTurns` (OpenCode's `steps`, Command Code's exit 8,
Claude Code's `error_max_turns`). **Who acts:** the workflow. **What to do:**
raise `maxTurns`, or give the node a smaller task.

## Budget limit

The node reached its `budgetUsd` or `budgetTokens`, or the run's
`limits.budgetUsd` or `limits.budgetTokens`, or none was left when it started. A
token cap counts input, output and cache-write tokens, not cache reads, and
stops the session at the next usage report, so it can pass the cap by one step
([budgets in tokens](./models-and-budgets/models-and-limits.md#budgets-in-tokens)).
**Who acts:** the workflow. **What to do:** raise the budget, then `ork resume`.

## Timed out

The node reached its `timeout`. **Who acts:** the workflow. **What to do:**
raise `timeout`, or give the node a smaller task. The run's own `limits.timeout`
ends the nodes still running the same way.

## Context too long

The conversation outgrew the model's context window. **Who acts:** the workflow.
**What to do:** give the node a smaller task or less context, or a model with a
larger window.

## Plan limit

A subscription window (for example the five-hour one) is used up. It stops the
whole run, and may pass. **Who acts:** your account. **What to do:** wait until
the window resets, then `ork resume`.

## Rate limited

The provider asked Ork to slow down (HTTP 429). It may pass. **Who acts:** the
provider. **What to do:** `ork resume` tries again.

## Provider unavailable

The provider was overloaded, answered with a server error (5xx), or the network
failed. It may pass. **Who acts:** the provider. **What to do:** `ork resume`
tries again.

## Not signed in

The driver's tool is not signed in, or the key it has was refused. **Who acts:**
your account. **What to do:** sign in to the tool again (`ork doctor` says how,
and [accounts](./accounts.md) lists each login), then `ork resume`.

## Out of credits

The account has no credit left. **Who acts:** your account. **What to do:** add
credit or use another account, then `ork resume`.

## Model unavailable

The model or the provider can't serve this request: an unknown model, a model
the account may not use, or a request the model refuses (for example "assistant
message prefill" from Claude through OpenCode's `commandcode` provider). **Who
acts:** your account. **What to do:** use another model or driver for the node
([drivers](./drivers.md)).

## Interrupted

You stopped the node, or the run. **Who acts:** you. **What to do:**
`ork resume` goes on from where it stopped. A stop by you ends the nodes still
running as interrupted; the run's own `limits.timeout` ends them as timed out.
The run's status says why.

## Tool missing

The driver's program, or a tool node's (`git`, `gh`, `aws`, a script), is not
installed or not on `PATH`. **Who acts:** your account. **What to do:** install
it (`ork doctor` checks the drivers), then `ork resume`.

## Command failed

A tool node's command exited with a non-zero code. **Who acts:** the workflow.
**What to do:** read its output under Details; fix the command or let a
condition handle the failure. Ork files no feedback, since this is its answer.

## Invalid output

A tool node's JSON broke its declared `output.schema`. **Who acts:** the
workflow. **What to do:** make the command print what the schema declares.

## Invalid node

The node could not start: its settings, an MCP server it names, a `forEach` list
or a `watch` condition was wrong. **Who acts:** the workflow. **What to do:**
fix the node in the workflow file; `ork validate` checks most of it.

## Driver crashed

The driver's process ended in a way Ork can't read. **Who acts:** Ork. **What to
do:** its last output is under Details. Ork files it as a bug.

## Unknown

Nothing Ork knows matched. **Who acts:** Ork. **What to do:** its details say
what happened; Ork files a bug with them (scrubbed), so a rule can be added.
`ork feedback` lists it ([feedback](./feedback.md)).
