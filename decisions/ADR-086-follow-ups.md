# ADR-086 — Follow-ups: what a change leaves for later, apart from feedback

- **Status:** Accepted
- **Date:** 2026-11-12
- **Topic:** follow-ups, project rules, runtime tools, `build`, server, UI
- **RFC:** waived: the maintainer decided it directly in discussion on
  2026-11-11, weighing the options below; the plan "Follow-ups"

## Context

A shipped change leaves work behind, and not only code: in `se-backend`, after a
feature merges, a message to a partner, a note to an agent working in another
project on the same machine, infra work only the maintainer can do, a check
after deploy. That work lived in the maintainer's head. Ork already had two
nearby things, and neither fits: **feedback** is about the process (improving
Ork, workflows and a project's context) and is deliberately never a backlog
([ADR-013](./ADR-013-feedback-loop.md)), and the `docs` node writes
**insights**, things learned that are not work, into specs and memories. A
session that notices "tell the partner the webhook moved" has nowhere to put it,
and the maintainer has nowhere to look when the pull request merges.

## Decision

- **Follow-ups are their own concept**, about the product, not a feedback kind
  and not insights. A follow-up says who acts (`for`: `agent`, `me`,
  `project:<name>`, `person:<name>`), what kind of work it is (`kind`: `change`,
  `message`, `task`, `check`) and when it is due (`due`: `now`, `after-merge`,
  `after-deploy`, a date). A feedback item never lists one, and a follow-up
  never reaches `ork feedback`, lessons or `ork feedback publish`.
- **A new session tool, `follow_up`**, given to every agent node in a run that
  keeps follow-ups: capped at 30 per session, duplicates merged by `for`, files
  and a near title. It is a new Ork MCP tool beside `feedback`, with its own
  port on the runtime (`RunOptions.followUps`), and refuses what is malformed
  with what to fix.
- **Where they are kept is a project rule**,
  `followUps: { store, file?, label? }` in `project.yaml`: `store` (Ork's local
  store, the default, never committed), `file` (appended to a markdown file in
  the session's worktree, so committed with the change and public in a public
  repository) or `github` (issues through the user's own `gh`, label
  `ork-follow-up`, falling back to the store and saying so). Ork's store indexes
  every follow-up whatever the rule, so one list and one due check serve them
  all. Each place is an adapter in a registry, not a branch in shared code
  ([ADR-022](./ADR-022-integration-registry.md)).
- **Ork drafts for people and never sends to them.** A `message` to a person is
  a draft the maintainer copies, sends and marks sent. The one exception that
  needs no credential Ork holds is a comment on an issue or pull request through
  the user's `gh`, and only after the maintainer confirms exactly that text
  (`--confirm`, or the panel's dialog sending the draft's digest). A task's
  steps and commands are shown and never run. Nothing reaches a person, or
  another project's session, outside those rules.
- **Due by watching, not by agents.** An `after-merge` follow-up waits on the
  pull request or branch its run published (recorded by
  `ork follow-ups published`) and becomes due when the user's `gh` shows it
  merged; a ref closed unmerged becomes due with a note, never dropped silently.
  Dated ones are due on the day, `after-deploy` ones when someone says so. The
  check runs on every `ork follow-ups` call and server read, and every 10
  minutes while `ork watch` or `ork ui` runs.
- **Delivery by `for`.** `agent`: `ork run <workflow> --follow-ups <ids>` takes
  them as the run's `brief`, done when it publishes. `project:<name>`: kept in
  that registered project's list through its own rule, and told to its live run
  through the relay's notice; an unknown project is refused, naming the
  registered ones. `me`: a checklist. `person:<name>`: a draft.
- **Text is scrubbed first** with the feedback redactor before it is stored,
  written to a file, relayed or posted. Ork reads no token.
- **`build` asks once.** After `review` passes, a `followups` node collects the
  reviewers' notes, the leader's unchecked and the decisions into items with a
  recommendation; a gate asks `take-recommended`, `defer-all` or `choose-each`;
  chosen `agent` items due now are done in one `polish` round with a
  correctness-only `polish-review`; the rest are recorded with `follow_up` after
  the change is published, and the insights go to `docs`. An agent never defers,
  drops or sends on its own.
- **Surfaces:** `ork follow-ups` (list, show, add, done, drop, reopen, due,
  post, published), the server's follow-up routes and the overview stream's
  `followUps` due count, and the UI's Follow-ups panel.

The spec is [follow-ups](../specs/follow-ups.md); what was left simpler is in
[its limits](../specs/gaps/follow-ups-limits.md).

## Options considered

- **A feedback kind.** Rejected by the maintainer: feedback is about the process
  and is never a backlog, and a merged "tell the partner" item would be
  published, made a lesson or merged by triage.
- **Insights as follow-ups.** Rejected: insights are things learned, written
  once into specs and memories by `docs`; they have no one to act and no due
  date.
- **Folding the question into `ratify`.** Rejected: `ratify` is about decisions
  made, and a separate gate keeps it one question by default with per-item
  questions on request.
- **Sending messages through the user's MCP servers** (Slack, email). Left out
  for now: Ork would then send to people itself, which this decision keeps for
  the maintainer, and it would depend on servers Ork does not own.
- **Keeping another project's follow-ups in this project's list.** Rejected: it
  belongs to the project that will act on it, under that project's rule.

## Rationale

The work is real and has an owner and a time. Keeping it in the project's chosen
place, telling the maintainer when it comes due, and delivering what Ork can
without a credential it does not hold removes the maintainer's memory as the
store. Drafting and confirming keeps a person in the loop for everything that
leaves the machine toward another person. A `file` store is a choice the project
makes knowing it is committed. One concept with one tool, one rule and one list
avoids a second, hidden backlog inside feedback.

## Consequences

- A new runtime port and tool, a `follow_ups` table (migration 20), a project
  rule, a CLI command, server routes, a stream event, a UI panel and five new
  `build` nodes (and `declare` and `published`), with specs, a guide and limits
  (L300 to L312).
- A `file` store is public in a public repository; the guide says so.
- The redactor, made for what leaves the machine, also rewrites emails and hosts
  in drafts and commands (L303).
- Closing a follow-up changes Ork's store only; the `file` entry and the GitHub
  issue are not rewritten or closed, and a closure on GitHub is not synced back
  (L300, L301).
- `build`'s recording after publish relies on its own `published` node (L308).
