/**
 * @file Doc links that several maps use: the sections of the design doc, the
 *   user guides, and the built schema package. `tools/check.mjs` checks that
 *   every path exists and that every `#anchor` matches a heading.
 */

import { d } from "./types.js";

export const DESIGN = {
  concepts: d("specs/concepts.md", "Spec: core concepts"),
  packages: d("specs/architecture.md", "Spec: the packages"),
  runtime: d(
    "specs/runtime.md",
    "Spec: the runtime adapter and its two drivers",
  ),
  format: d("specs/workflow-format.md", "Spec: the workflow file format"),
  context: d("specs/context.md", "Spec: context, skills and precedence"),
  messaging: d("specs/messaging.md", "Spec: messaging, decisions and logs"),
  eventStore: d("specs/event-store.md", "Spec: the event store"),
  feedback: d("specs/feedback.md", "Spec: feedback and self-improvement"),
  cli: d("specs/cli.md", "Spec: the CLI commands"),
  scheduler: d("specs/scheduler.md", "Spec: running a workflow"),
  worktrees: d("specs/worktrees.md", "Spec: worktrees, where nodes work"),
  ui: d("specs/ui.md", "Spec: the UI panels"),
  server: d("specs/server.md", "Spec: the local server and `ork ui`"),
  milestones: d("specs/design.md#milestones", "Design: milestones"),
};

/** User docs; the group keeps its old name, from when they were in the README. */
export const README = {
  accounts: d("docs/guides/accounts.md", "Guide: accounts and credentials"),
};

export const SCHEMA = {
  nodes: d(
    "packages/schema/src/nodes.ts",
    "Code: the node types and their fields",
  ),
  workflow: d("packages/schema/src/workflow.ts", "Code: the workflow schema"),
  yaml: d(
    "packages/schema/src/yaml.ts",
    "Code: parsing, diagnostics, canonical YAML",
  ),
  edges: d("packages/schema/src/edges.ts", "Code: edge shorthand"),
  jsonSchema: d(
    "packages/schema/workflow.schema.json",
    "The published JSON Schema",
  ),
  tests: d(
    "packages/schema/test/yaml.test.ts",
    "Tests: round-trip and diagnostics",
  ),
  example: d(
    "examples/software-factory.ork.yaml",
    "Example: the software-factory workflow",
  ),
};

export const CORE = {
  compile: d("packages/core/src/graph/compile.ts", "Code: the graph compiler"),
  flow: d(
    "packages/core/src/graph/flow.ts",
    "Code: edges, bounded cycles, entries, reachability",
  ),
  tree: d("packages/core/src/graph/tree.ts", "Code: the ownership rules"),
  expr: d("packages/core/src/expr/parse.ts", "Code: the expression language"),
  tests: d(
    "packages/core/test/compile.test.ts",
    "Tests: the compiler's checks",
  ),
  walk: d("specs/scheduler/walking.md", "Spec: walking every way through"),
  walkCode: d("packages/core/src/run/walk.ts", "Code: the walk"),
  walkAdr: d(
    "decisions/ADR-056-walking-a-workflow.md",
    "ADR-056: walking a workflow before it runs",
  ),
};

export const UI = {
  adr: d(
    "decisions/ADR-040-ui-stack.md",
    "ADR-040: React, Base UI, dockview, containerized-state, our own graph",
  ),
  app: d("packages/ui/src/app/app.tsx", "Code: the app's root"),
  assets: d(
    "packages/server/src/assets.ts",
    "Code: serving the built UI from the CLI's bundle",
  ),
  tests: d("packages/ui/test/app.test.tsx", "Tests: the app, with axe"),
  design: d(
    "specs/ui/design-system.md",
    "Spec: the design system, its tokens and themes",
  ),
  tokens: d(
    "packages/ui/test/tokens.test.ts",
    "Tests: every token pairing's contrast, and the layers",
  ),
  workspace: d(
    "specs/ui/workspace.md",
    "Spec: the workspace, its keys and the saved layout",
  ),
  workspaceTests: d(
    "packages/ui/test/workspace/dock.test.tsx",
    "Tests: the dock on real dockview",
  ),
  guide: d("docs/guides/browser-view.md", "Guide: the browser view"),
  panels: d("specs/ui/panels.md", "Spec: the panels"),
  decisions: d(
    "packages/ui/src/panels/decisions-panel.tsx",
    "Code: the Decisions panel",
  ),
  decisionTests: d(
    "packages/ui/test/panels/decisions-panel.test.tsx",
    "Tests: the Decisions panel's answers, keys and focus",
  ),
  panelTests: d(
    "packages/ui/test/panels/runs-panel.test.tsx",
    "Tests: the Runs panel's states, keys and rendering",
  ),
  state: d(
    "specs/ui/state.md",
    "Spec: the containers, stream links and event window",
  ),
  stateTests: d(
    "packages/ui/test/state/render-count.test.tsx",
    "Tests: a component re-renders only for its own slice",
  ),
  banner: d(
    "packages/ui/src/workspace/update-banner.tsx",
    "Code: the new-version banner",
  ),
  upgradeDialog: d(
    "packages/ui/src/workspace/upgrade-dialog.tsx",
    "Code: the Upgrade dialog, from the plan to the restart",
  ),
  bannerTests: d(
    "packages/ui/test/workspace/update-banner.test.tsx",
    "Tests: the banner's states, dismissal and axe",
  ),
  upgradeTests: d(
    "packages/ui/test/workspace/upgrade-dialog.test.tsx",
    "Tests: the Upgrade dialog's steps",
  ),
  bannerSpec: d(
    "specs/ui/workspace-frame-and-banner.md#the-new-version-banner",
    "Spec: the new-version banner and the Upgrade dialog",
  ),
  newVersions: d(
    "docs/guides/browser-view/new-versions.md",
    "Guide: new versions in the browser",
  ),
  copyRule: d(
    "specs/ui/design-components-and-copy.md#copy",
    "Spec: the copy rules, commands as code blocks",
  ),
  copyTests: d(
    "packages/ui/test/inline-commands.test.ts",
    "Tests: no command shown as inline code",
  ),
};

export const SERVER = {
  adr: d(
    "decisions/ADR-039-local-server.md",
    "ADR-039: a local server that is one more client of the store",
  ),
  server: d("packages/server/src/server.ts", "Code: starting the server"),
  contract: d(
    "packages/server/src/contract.ts",
    "Code: the API contract, shared with the typed client",
  ),
  guards: d(
    "packages/server/src/guards.ts",
    "Code: the token, Host, Origin and JSON checks",
  ),
  streams: d("packages/server/src/streams.ts", "Code: the event streams"),
  writes: d(
    "packages/server/src/write-routes.ts",
    "Code: answer, stop, message, start and resume",
  ),
  command: d("packages/cli/src/commands/ui.ts", "Code: `ork ui`"),
  remote: d(
    "packages/core/src/remote/detach.ts",
    "Code: starting a run detached, shared by the CLI and the server",
  ),
  tests: d("packages/server/test/write.test.ts", "Tests: the write routes"),
  e2e: d("packages/cli/test/ui.test.ts", "Tests: `ork ui` end to end"),
  supervise: d(
    "packages/cli/src/browser/supervise.ts",
    "Code: `ork ui` supervising its server, and restarting it",
  ),
  serve: d(
    "packages/cli/src/browser/serve.ts",
    "Code: `ork ui --serve`, the server's side",
  ),
  superviseTests: d(
    "packages/cli/test/supervise.test.ts",
    "Tests: the supervisor, with fake children",
  ),
  superviseAdr: d(
    "decisions/ADR-060-ork-ui-supervises-its-server.md",
    "ADR-060: `ork ui` supervises its server",
  ),
  updates: d(
    "packages/server/src/updates.ts",
    "Code: the server's record of versions, and its own daily check",
  ),
  updateRoutes: d(
    "packages/server/src/update-routes.ts",
    "Code: the version, upgrade and restart routes",
  ),
  updatesTests: d(
    "packages/server/test/updates.test.ts",
    "Tests: the record, the daily check and the stream's `version`",
  ),
  upgradeTests: d(
    "packages/server/test/upgrade.test.ts",
    "Tests: the upgrade's plan, its run and the restart hook",
  ),
  updatesSpec: d(
    "specs/cli/updates.md#in-ork-ui",
    "Spec: new versions in `ork ui`",
  ),
};

export const CLI = {
  validate: d("packages/cli/src/commands/validate.ts", "Code: `ork validate`"),
  init: d("packages/cli/src/commands/setup.ts", "Code: `ork init`"),
  doctor: d("packages/cli/src/doctor/checks.ts", "Code: `ork doctor`'s checks"),
  experiments: d(
    "packages/core/src/experiments.ts",
    "Code: the experiments registry and opt-in",
  ),
  experimentsSpec: d("specs/project-rules.md#experiments", "Spec: experiments"),
  experimentsAdr: d(
    "decisions/ADR-066-experiments-registry.md",
    "ADR-066: experiments, off by default",
  ),
  upgrade: d("packages/cli/src/commands/install.ts", "Code: `ork upgrade`"),
  updates: d(
    "specs/cli/updates.md",
    "Spec: the new-version notice and upgrade",
  ),
  tests: d("packages/cli/test/cli.test.ts", "Tests: init and validate"),
  completion: d(
    "packages/cli/src/commands/completion.ts",
    "Code: `ork completion` and the hidden `ork __complete`",
  ),
  completionSpec: d(
    "specs/cli/completion.md",
    "Spec: tab completion and the grouped `ork --help`",
  ),
  completionTests: d(
    "packages/cli/test/completion-values.test.ts",
    "Tests: completion's live values, read-only",
  ),
  run: d("packages/cli/src/commands/run.ts", "Code: the `ork run` command"),
  human: d(
    "packages/cli/src/human.ts",
    "Code: questions and permissions on the terminal",
  ),
  runWorkflow: d(
    "packages/cli/src/run/workflow.ts",
    "Code: `ork run` for a whole workflow",
  ),
  runTests: d("packages/cli/test/run.test.ts", "Tests: `ork run`"),
};

export const FEEDBACK = {
  lessons: d(
    "packages/core/src/feedback/lessons.ts",
    "Code: writing a lesson, marked with its item",
  ),
  lessonCap: d(
    "packages/core/src/context/lesson-cap.ts",
    "Code: the 1,500-token cap on a workflow's lessons",
  ),
  lessonTests: d(
    "packages/core/test/lessons.test.ts",
    "Tests: lessons and their cap",
  ),
  accept: d(
    "packages/core/src/feedback/accept.ts",
    "Code: `ork feedback accept`, as a lesson",
  ),
  acceptTests: d(
    "packages/core/test/accept.test.ts",
    "Tests: `ork feedback accept`",
  ),
  apply: d(
    "packages/cli/src/runs/apply.ts",
    "Code: `ork feedback apply`, and settling the item",
  ),
  applyTests: d(
    "packages/cli/test/apply.test.ts",
    "Tests: `ork feedback apply`",
  ),
  triage: d(
    "packages/core/src/feedback/triage.ts",
    "Code: near-duplicate items, by rules",
  ),
  triageTests: d("packages/core/test/triage.test.ts", "Tests: triage"),
  redact: d(
    "packages/core/src/feedback/redact.ts",
    "Code: redaction, the post and its marker",
  ),
  discussions: d(
    "packages/core/src/feedback/discussions.ts",
    "Code: Discussions through your gh",
  ),
  publishTests: d("packages/core/test/publish.test.ts", "Tests: publishing"),
  share: d(
    "packages/cli/src/commands/feedback-share.ts",
    "Code: `ork feedback publish`, `export`, `import`",
  ),
  jsonl: d("packages/cli/src/runs/jsonl.ts", "Code: feedback as JSON lines"),
  shareTests: d(
    "packages/cli/test/share.test.ts",
    "Tests: export, import, preview",
  ),
  applyWorkflow: d(
    "packages/core/workflows/feedback-apply.ork.yaml",
    "Code: Ork's own `ork:feedback-apply` workflow",
  ),
  builtins: d(
    "packages/core/src/project/builtin-files.ts",
    "Code: built-in workflows by their `ork:` names",
  ),
  builtinTests: d(
    "packages/core/test/builtin-workflows.test.ts",
    "Tests: the built-in workflows",
  ),
  agent: d(
    "packages/core/src/feedback/agent.ts",
    "Code: agents' reports, capped and masked",
  ),
  signals: d(
    "packages/core/src/feedback/signals.ts",
    "Code: system signals from a run's events",
  ),
  fingerprint: d(
    "packages/core/src/feedback/fingerprint.ts",
    "Code: fingerprints and default targets",
  ),
  store: d(
    "packages/core/src/store/feedback.ts",
    "Code: records and items in the store",
  ),
  tool: d(
    "packages/runtime-claude/src/tools/feedback.ts",
    "Code: the feedback tool",
  ),
  cli: d("packages/cli/src/runs/feedback.ts", "Code: `ork feedback`'s output"),
  tests: d("packages/core/test/feedback.test.ts", "Tests: feedback capture"),
  cliTests: d(
    "packages/cli/test/feedback.test.ts",
    "Tests: feedback in a run and `ork feedback`",
  ),
  adr: d(
    "decisions/ADR-028-feedback-capture.md",
    "Decision: how feedback is captured",
  ),
  loopAdr: d(
    "decisions/ADR-059-closing-the-feedback-loop.md",
    "ADR-059: built-in workflows, triage by rules, previewed publishing",
  ),
  guide: d("docs/guides/feedback.md", "Guide: feedback from your runs"),
  limits: d("specs/feedback/limits.md", "Limits: the feedback loop, for now"),
  human: d(
    "packages/core/src/feedback/human.ts",
    "Code: a person's note, from the CLI, `ork decide` or the UI",
  ),
  noteTests: d(
    "packages/cli/test/decide-note.test.ts",
    "Tests: `ork decide --note`",
  ),
  triageCommand: d(
    "packages/cli/src/runs/triage.ts",
    "Code: `ork feedback triage`, asking before each merge",
  ),
  actions: d(
    "packages/core/src/feedback/actions.ts",
    "Code: which actions an item allows, for the CLI and the panel",
  ),
  actionTests: d(
    "packages/core/test/feedback-actions.test.ts",
    "Tests: what an item allows, and why not",
  ),
  preview: d(
    "packages/core/src/feedback/preview.ts",
    "Code: an `ork` item as the post it would be",
  ),
  routes: d(
    "packages/server/src/feedback-routes.ts",
    "Code: the feedback routes, on the same core functions",
  ),
  publishRoute: d(
    "packages/server/src/feedback-publish.ts",
    "Code: the panel's preview, its digest, and the post",
  ),
  applyRoute: d(
    "packages/server/src/feedback-apply.ts",
    "Code: the panel's Propose fix, started in the background",
  ),
  routeTests: d(
    "packages/server/test/feedback-items.test.ts",
    "Tests: the feedback routes",
  ),
  panel: d(
    "packages/ui/src/panels/feedback-panel.tsx",
    "Code: the Feedback panel",
  ),
  panelTests: d(
    "packages/ui/test/panels/feedback-panel.test.tsx",
    "Tests: the Feedback panel's list, item and keys",
  ),
  dialogTests: d(
    "packages/ui/test/panels/feedback-dialogs.test.tsx",
    "Tests: Add lesson, Propose fix and Publish",
  ),
  axeTests: d(
    "packages/ui/test/panels/feedback-axe.test.tsx",
    "Tests: the Feedback panel under axe",
  ),
  publishDialog: d(
    "packages/ui/src/panels/publish-dialog.tsx",
    "Code: the publish dialog, previewed then confirmed",
  ),
  publishDialogTests: d(
    "packages/ui/test/panels/feedback-publish.test.tsx",
    "Tests: publishing from the panel",
  ),
  noteDialog: d(
    "packages/ui/src/panels/note-dialog.tsx",
    "Code: the Monitor's Note dialog",
  ),
  noteDialogTests: d(
    "packages/ui/test/panels/note-dialog.test.tsx",
    "Tests: the Note dialog",
  ),
  panelSpec: d(
    "specs/ui/panels-context-and-feedback.md#feedback",
    "Spec: the Feedback panel",
  ),
};

export const STORE = {
  store: d(
    "packages/core/src/store/sqlite.ts",
    "Code: the store on node:sqlite",
  ),
  recorder: d(
    "packages/core/src/store/recorder.ts",
    "Code: recording a run, masked, with its JSONL copy",
  ),
  view: d("packages/core/src/store/view.ts", "Code: the ownership tree view"),
  tests: d("packages/core/test/store.test.ts", "Tests: the event store"),
  readOnlyTests: d(
    "packages/core/test/store-read-only.test.ts",
    "Tests: the store opened read-only",
  ),
  commands: d(
    "packages/cli/src/commands/runs.ts",
    "Code: `ork ps`, `ork logs`, `ork tree`",
  ),
  cliTests: d("packages/cli/test/runs.test.ts", "Tests: recorded runs"),
  adr: d("decisions/ADR-024-event-store.md", "ADR-024: the event store"),
};

export const CONTROL = {
  queue: d("packages/core/src/control/queue.ts", "Code: the decision queue"),
  control: d(
    "packages/core/src/control/control.ts",
    "Code: a live run's watcher and control",
  ),
  socket: d("packages/core/src/control/socket.ts", "Code: the run's socket"),
  tests: d(
    "packages/core/test/control.test.ts",
    "Tests: decisions and the socket",
  ),
  commands: d(
    "packages/cli/src/commands/decide.ts",
    "Code: `ork decide`, and its `--note`",
  ),
  pause: d(
    "packages/cli/src/commands/pause.ts",
    "Code: `ork pause` and `ork continue`",
  ),
  holds: d(
    "packages/core/src/run/holds.ts",
    "Code: a run's holds and a node's stop",
  ),
  hold: d(
    "packages/runtime-claude/src/hold.ts",
    "Code: holding a session before its next tool call",
  ),
  holdTests: d(
    "packages/core/test/holds.test.ts",
    "Tests: pause, continue and a node's stop",
  ),
  adr: d(
    "decisions/ADR-041-pause-continue-stop.md",
    "ADR-041: pause holds a session before its next tool call",
  ),
  spec: d("specs/run-control.md", "Spec: pause, continue and stop"),
  detach: d("packages/core/src/remote/detach.ts", "Code: `ork run --detach`"),
  cliTests: d("packages/cli/test/control.test.ts", "Tests: decide and stop"),
  say: d(
    "packages/cli/test/decide-say.test.ts",
    "Tests: `ork decide --say`, a note with the answer",
  ),
  notesAdr: d(
    "decisions/ADR-062-notes-on-decision-answers.md",
    "ADR-062: an answer may carry a note",
  ),
};

/** A child's question to its leader first (`questions: owner`). */
export const QUESTIONS = {
  spec: d(
    "specs/messaging/leader-questions.md",
    "Spec: a child's question to its leader first",
  ),
  asks: d(
    "packages/nodes/src/owner-asks.ts",
    "Code: asking a fork of the leader's session",
  ),
  owners: d(
    "packages/core/src/run/owners.ts",
    "Code: who takes a node's questions first",
  ),
  tests: d(
    "packages/cli/test/owner-questions.test.ts",
    "Tests: leader questions, against a stand-in claude",
  ),
  unitTests: d(
    "packages/nodes/test/owner-asks.test.ts",
    "Tests: no session, no budget, a failed or late fork, a stop, a pause, a read-only fork",
  ),
  forkTests: d(
    "packages/runtime-claude/test/fork.test.ts",
    "Tests: both drivers fork a session",
  ),
  adr: d(
    "decisions/ADR-063-leader-questions.md",
    "ADR-063: a fork of the leader's session answers first",
  ),
};

export const BUS = {
  bus: d("packages/core/src/run/bus.ts", "Code: the message bus"),
  contacts: d(
    "packages/core/src/run/contacts.ts",
    "Code: who may write to whom, for the bus and `ork send`",
  ),
  rules: d(
    "packages/core/src/run/rules.ts",
    "Code: firing a node's `notify:` rules",
  ),
  send: d("packages/core/src/remote/send.ts", "Code: `ork send`'s checks"),
  sendCommand: d("packages/cli/src/commands/send.ts", "Code: `ork send`"),
  sendTests: d("packages/cli/test/send.test.ts", "Tests: the real `ork send`"),
  ruleTests: d(
    "packages/core/test/notify.test.ts",
    "Tests: contacts, rules and a message's `via`",
  ),
  scriptsSpec: d(
    "specs/messaging/scripts.md",
    "Spec: scripts and rules on the bus",
  ),
  escalation: d(
    "packages/core/src/run/escalation.ts",
    "Code: loops out of rounds, asking a live owner first",
  ),
  tests: d(
    "packages/core/test/bus.test.ts",
    "Tests: addressing, notices and owner questions",
  ),
  tools: d(
    "packages/runtime-claude/src/tools/messages.ts",
    "Code: send_message, read_inbox and answer",
  ),
  toolTests: d(
    "packages/runtime-claude/test/messages.test.ts",
    "Tests: the message tools",
  ),
  claims: d("packages/core/src/run/claims.ts", "Code: the run's claims"),
  claimTests: d(
    "packages/core/test/claims.test.ts",
    "Tests: overlapping claims, notices and release",
  ),
  claimTools: d(
    "packages/runtime-claude/src/tools/claims.ts",
    "Code: claim and release",
  ),
  claimAdr: d(
    "decisions/ADR-027-advisory-claims.md",
    "Decision: advisory claims",
  ),
  chat: d("packages/cli/src/runs/chat.ts", "Code: `ork chat`, live or resumed"),
  chatTests: d("packages/cli/test/chat.test.ts", "Tests: `ork chat`"),
};

export const LINKS = {
  spec: d("specs/messaging/links.md", "Spec: links between runs"),
  adr: d(
    "decisions/ADR-044-relay-between-runs.md",
    "ADR-044: a relay between runs",
  ),
  links: d(
    "packages/core/src/remote/links.ts",
    "Code: making and ending links, telling each side",
  ),
  relay: d(
    "packages/core/src/remote/relay.ts",
    "Code: a run's side of the relay",
  ),
  store: d(
    "packages/core/src/store/links.ts",
    "Code: the store's `links` table",
  ),
  command: d("packages/cli/src/commands/relay.ts", "Code: `ork relay`"),
  control: d(
    "packages/core/src/control/control.ts",
    "Code: a run taking its `relay` and `notice` commands",
  ),
  tools: d(
    "packages/runtime-claude/src/tools/messages.ts",
    "Code: the message tools, `wait_for_messages`",
  ),
  tests: d(
    "packages/core/test/relay.test.ts",
    "Tests: two runs over real sockets",
  ),
  cliTests: d("packages/cli/test/relay.test.ts", "Tests: `ork relay`"),
  guide: d(
    "docs/guides/working-across-projects.md",
    "Guide: working across projects",
  ),
};

export const CALLS = {
  spec: d("specs/scheduler/calls.md", "Spec: calling workflows"),
  adr: d(
    "decisions/ADR-045-workflows-calling-workflows.md",
    "ADR-045: workflows calling workflows",
  ),
  node: d("packages/nodes/src/call.ts", "Code: the `workflow.call` node"),
  port: d(
    "packages/core/src/remote/calls.ts",
    "Code: starting, counting and stopping called runs",
  ),
  start: d(
    "packages/core/src/remote/call-start.ts",
    "Code: starting a called run, or reviving it on resume",
  ),
  wait: d(
    "packages/core/src/remote/call-wait.ts",
    "Code: waiting on a called run or node",
  ),
  talk: d(
    "packages/core/src/remote/call-talk.ts",
    "Code: a channel to a call, and its conversation",
  ),
  routes: d(
    "packages/core/src/run/bus-calls.ts",
    "Code: how the bus reaches a call by name",
  ),
  host: d(
    "packages/cli/src/run/calls.ts",
    "Code: the budget cap and caller a run is started with",
  ),
  compile: d(
    "packages/core/src/graph/calls.ts",
    "Code: the compiler's checks on calls",
  ),
  targets: d(
    "packages/core/src/project/calls.ts",
    "Code: `ork validate`'s check of what a call names",
  ),
  tests: d("packages/core/test/calls.test.ts", "Tests: calling workflows"),
  targetTests: d(
    "packages/core/test/call-targets.test.ts",
    "Tests: what `ork validate` checks of a call",
  ),
  guide: d(
    "docs/guides/working-across-projects.md#calling-a-workflow",
    "Guide: calling a workflow",
  ),
};

export const TIMEOUTS = {
  code: d(
    "packages/core/src/run/timeouts.ts",
    "Code: timeouts on nodes and runs",
  ),
  spawn: d(
    "packages/nodes/src/spawn.ts",
    "Code: a tool in its own process group",
  ),
  tests: d("packages/core/test/timeouts.test.ts", "Tests: timeouts"),
  spawnTests: d(
    "packages/nodes/test/spawn.test.ts",
    "Tests: an abort ends what a tool started",
  ),
  spec: d("specs/scheduler.md#timeouts", "Spec: timeouts"),
  adr: d("decisions/ADR-043-timeouts.md", "ADR-043: timeouts"),
};

export const WATCH = {
  node: d(
    "packages/core/src/run/watch.ts",
    "Code: a `watch:`, repeating a look until a condition holds",
  ),
  execute: d(
    "packages/core/src/run/execute.ts",
    "Code: running an activation, or each look of one",
  ),
  events: d(
    "packages/core/src/run/watch-events.ts",
    "Code: what a `watch:` records",
  ),
  check: d(
    "packages/core/src/graph/watch.ts",
    "Code: refusing a wait that can't end",
  ),
  format: d(
    "packages/schema/src/settings.ts",
    "Code: the `watch:` block and its floor",
  ),
  state: d("packages/nodes/src/tool-state.ts", "Code: `$ORK_STATE`"),
  tests: d("packages/core/test/watch.test.ts", "Tests: a `watch:`"),
  example: d("examples/wait-for-ci.ork.yaml", "Example: wait for CI, fix it"),
  watcher: d(
    "packages/core/src/triggers/watcher.ts",
    "Code: the watcher and its guards",
  ),
  trust: d(
    "packages/core/src/triggers/trust.ts",
    "Code: what a person accepts, as a hash",
  ),
  project: d(
    "packages/core/src/triggers/project.ts",
    "Code: reading each project's triggers",
  ),
  checkTrigger: d(
    "packages/core/src/triggers/check.ts",
    "Code: checking triggers against the workflows",
  ),
  lock: d(
    "packages/core/src/triggers/lock.ts",
    "Code: one `ork watch` per machine",
  ),
  status: d(
    "packages/core/src/triggers/status.ts",
    "Code: how the triggers stand",
  ),
  store: d(
    "packages/core/src/store/triggers.ts",
    "Code: the `triggers`, `trigger_seen` and `watch_lock` tables",
  ),
  file: d(
    "packages/schema/src/triggers.ts",
    "Code: the `triggers.yaml` format",
  ),
  command: d("packages/cli/src/commands/watch.ts", "Code: `ork watch`"),
  look: d("packages/cli/src/watch/look.ts", "Code: one look at a source"),
  start: d("packages/cli/src/watch/start.ts", "Code: starting a trigger's run"),
  report: d(
    "packages/cli/src/watch/report.ts",
    "Code: what `--status` and `--accept` print",
  ),
  expect: d(
    "packages/cli/src/run/workflow.ts",
    "Code: `--expect-workflow`, refusing a changed file",
  ),
  triggerTests: d(
    "packages/core/test/triggers.test.ts",
    "Tests: the guards, trust and checks",
  ),
  cliTests: d(
    "packages/cli/test/watch.test.ts",
    "Tests: looks, starts, the lock and who may accept",
  ),
  route: d(
    "packages/server/src/read-routes.ts",
    "Code: `GET /api/triggers`, among the read routes",
  ),
  facts: d(
    "packages/ui/src/panels/watch-facts.ts",
    "Code: the Monitor's watch facts",
  ),
  factsTests: d(
    "packages/ui/test/panels/watch-facts.test.ts",
    "Tests: the Monitor's watch facts",
  ),
  section: d(
    "packages/ui/src/panels/triggers-section.tsx",
    "Code: the Triggers section of the Runs panel",
  ),
  until: d(
    "packages/ui/src/builder/until-picker.tsx",
    "Code: the builder's until picker",
  ),
  spec: d("specs/scheduler/watching.md", "Spec: watching a source"),
  limits: d("specs/scheduler/watching-limits.md", "Limits: watching a source"),
  adr: d(
    "decisions/ADR-053-watching-a-source.md",
    "ADR-053: watching a source",
  ),
  guide: d("docs/guides/watching.md", "Guide: watching a source"),
};

export const RESUME = {
  resume: d(
    "packages/core/src/run/resume.ts",
    "Code: a run's events read back for `ork resume`",
  ),
  tests: d("packages/core/test/resume.test.ts", "Tests: resuming a run"),
};

export const ENGINE = {
  scheduler: d("packages/core/src/run/scheduler.ts", "Code: the scheduler"),
  routing: d(
    "packages/core/src/run/routing.ts",
    "Code: edges, joins, routers and dead paths",
  ),
  tests: d("packages/core/test/scheduler.test.ts", "Tests: the scheduler"),
  delegation: d(
    "packages/core/src/run/delegation.ts",
    "Code: a leader's delegate and spawn_worker",
  ),
  delegationTests: d(
    "packages/core/test/delegation.test.ts",
    "Tests: delegation, spawned workers and leader resume",
  ),
  rounds: d(
    "packages/core/test/rounds.test.ts",
    "Tests: rounds, and a join behind a branch that can't run",
  ),
};

export const NODE_TYPES = {
  claude: d("packages/nodes/src/claude.ts", "Code: Claude nodes"),
  tools: d("packages/nodes/src/tools.ts", "Code: tool nodes"),
  gate: d("packages/nodes/src/gate.ts", "Code: human gates"),
  verify: d("packages/nodes/src/verify.ts", "Code: checks on a report"),
  mcp: d("packages/nodes/src/mcp-call.ts", "Code: MCP calls"),
  steps: d(
    "specs/scheduler/steps.md",
    "Spec: steps around a session, and MCP calls",
  ),
  tests: d("packages/nodes/test/nodes.test.ts", "Tests: the node types"),
};

export const INTEGRATIONS = {
  registry: d(
    "packages/integrations/src/registry.ts",
    "Code: the integration and driver registries",
  ),
  port: d(
    "packages/integrations/src/integration.ts",
    "Code: the integration port",
  ),
  adr: d(
    "decisions/ADR-022-integration-registry.md",
    "Decision: integrations as adapters",
  ),
};

export const PRACTICES = {
  code: d(
    "packages/core/src/practices/practices.ts",
    "Code: the built-in practices",
  ),
  tests: d(
    "packages/core/test/practices.test.ts",
    "Tests: practices and their cascade",
  ),
  spec: d("specs/context.md#built-in-practices", "Spec: built-in practices"),
};

export const CONTEXT = {
  agentCatalog: d(
    "packages/core/src/agents/catalog.ts",
    "Code: the agent catalog",
  ),
  agentApply: d(
    "packages/core/src/agents/apply.ts",
    "Code: filling agent nodes",
  ),
  agentTests: d("packages/core/test/agents.test.ts", "Tests: agents"),
  agentLinks: d(
    "packages/core/src/agents/links.ts",
    "Code: linking tool folders to `.ork/`",
  ),
  linkTests: d("packages/core/test/links.test.ts", "Tests: `ork link`"),
  originAdr: d(
    "decisions/ADR-031-ork-is-the-origin.md",
    "ADR-031: `.ork/` is the origin",
  ),
  agentsCli: d("packages/cli/src/commands/setup.ts", "Code: `ork agents`"),
  resolver: d(
    "packages/core/src/context/resolve.ts",
    "Code: the layer resolver",
  ),
  skills: d(
    "packages/core/src/context/skills.ts",
    "Code: skills, references and built-ins",
  ),
  files: d(
    "packages/core/src/context/files.ts",
    "Code: context files and lessons",
  ),
  session: d(
    "packages/core/src/context/session.ts",
    "Code: prompt sections, the plugin and settings",
  ),
  tests: d(
    "packages/core/test/context.test.ts",
    "Tests: layers, shadowing, references, the plugin",
  ),
  explain: d(
    "packages/cli/src/commands/context.ts",
    "Code: `ork context explain`",
  ),
  explainSession: d(
    "packages/core/src/run/explain.ts",
    "Code: planning what a node's session loads",
  ),
  explainSessionTests: d(
    "packages/core/test/explain.test.ts",
    "Tests: what a node's session loads, with its words",
  ),
  explainTests: d(
    "packages/cli/test/context.test.ts",
    "Tests: `ork context explain`",
  ),
  version: d(
    "packages/integrations/src/drivers.ts",
    "Code: the `claude` version check",
  ),
};

export const WORKTREES = {
  manager: d(
    "packages/core/src/worktree/manager.ts",
    "Code: Ork's git worktrees",
  ),
  workspace: d(
    "packages/core/src/worktree/workspace.ts",
    "Code: where each node works, commits and merges",
  ),
  list: d(
    "packages/core/src/worktree/list.ts",
    "Code: what `ork worktrees` lists, with git's state",
  ),
  clean: d(
    "packages/core/src/worktree/clean.ts",
    "Code: the clean plan, one rule for the CLI and the panel",
  ),
  remove: d(
    "packages/core/src/worktree/remove.ts",
    "Code: removing one item, and the work it would lose",
  ),
  words: d(
    "packages/core/src/worktree/words.ts",
    "Code: the words the CLI and the panel share",
  ),
  removeTests: d(
    "packages/core/test/worktree-remove.test.ts",
    "Tests: one item's plan, what it loses, and removing it",
  ),
  command: d(
    "packages/cli/src/commands/projects.ts",
    "Code: `ork register`, `ork projects` and `ork migrate`",
  ),
  worktreesCommand: d(
    "packages/cli/src/commands/worktrees.ts",
    "Code: `ork worktrees`: list, clean and remove",
  ),
  worktreesTests: d(
    "packages/cli/test/worktrees.test.ts",
    "Tests: `ork worktrees remove`, and a live run's worktree kept",
  ),
  commandSpec: d(
    "specs/worktrees.md#ork-worktrees",
    "Spec: `ork worktrees` list, clean and remove",
  ),
  panel: d(
    "packages/ui/src/panels/worktrees-panel.tsx",
    "Code: the Worktrees panel",
  ),
  panelTests: d(
    "packages/ui/test/panels/worktrees-panel.test.tsx",
    "Tests: the Worktrees panel's list, keys and axe",
  ),
  dialogTests: d(
    "packages/ui/test/panels/worktrees-dialogs.test.tsx",
    "Tests: Remove… and Clean merged…, read then confirmed",
  ),
  panelSpec: d("specs/ui/panels-worktrees.md", "Spec: the Worktrees panel"),
  routes: d(
    "packages/server/src/worktrees-routes.ts",
    "Code: the Worktrees panel's routes",
  ),
  routeTests: d(
    "packages/server/test/worktrees.test.ts",
    "Tests: the worktrees routes, against the plan's digest",
  ),
  guide: d(
    "docs/guides/worktrees.md#in-the-browser",
    "Guide: worktrees in the browser",
  ),
  places: d(
    "packages/core/src/project/place.ts",
    "Code: where a project's files live, in-repo or attached",
  ),
  register: d(
    "packages/cli/src/project/register.ts",
    "Code: registering a project",
  ),
  migrate: d(
    "packages/cli/src/project/migrate.ts",
    "Code: `ork migrate`, attached to in-repo",
  ),
  draft: d(
    "packages/cli/src/project/draft.ts",
    "Code: drafting a workflow from agents",
  ),
  migrateTests: d(
    "packages/cli/test/migrate.test.ts",
    "Tests: a project and its agents move into `.ork/`",
  ),
  migrateAdr: d("decisions/ADR-036-ork-migrate.md", "ADR-036: `ork migrate`"),
  projectsSpec: d("specs/projects.md", "Spec: projects, in-repo or attached"),
  projectsTests: d(
    "packages/cli/test/projects.test.ts",
    "Tests: an attached project registers and runs untouched",
  ),
  projectsAdr: d(
    "decisions/ADR-035-projects-in-repo-or-attached.md",
    "ADR-035: in the repository, or attached",
  ),
  tests: d(
    "packages/core/test/worktree.test.ts",
    "Tests: worktrees in a real repository",
  ),
  handoff: d(
    "packages/core/src/worktree/handoff.ts",
    "Code: opening worktrees and handing work over by the rules",
  ),
  patch: d(
    "packages/core/src/worktree/patch.ts",
    "Code: work moved as patches, without commits",
  ),
  rules: d("packages/core/src/project/rules.ts", "Code: project rules"),
  rulesTests: d("packages/core/test/rules.test.ts", "Tests: project rules"),
  rulesSpec: d("specs/project-rules.md", "Spec: project rules"),
  rulesAdr: d("decisions/ADR-032-project-rules.md", "ADR-032: project rules"),
};

export const RUNTIME = {
  port: d("packages/core/src/runtime/types.ts", "Code: the runtime port"),
  report: d(
    "packages/core/src/runtime/report.ts",
    "Code: the node report as structured output",
  ),
  plan: d("packages/core/src/run/plan.ts", "Code: a node's session spec"),
  sdk: d("packages/runtime-claude/src/sdk.ts", "Code: the SDK driver"),
  cli: d("packages/runtime-claude/src/cli.ts", "Code: the CLI driver"),
  mcp: d(
    "packages/runtime-claude/src/mcp-http.ts",
    "Code: Ork's local MCP server",
  ),
  tools: d(
    "packages/runtime-claude/src/tools/registry.ts",
    "Code: the registry of Ork's tools",
  ),
  delegate: d(
    "packages/runtime-claude/src/tools/delegate.ts",
    "Code: the delegate and spawn_worker tools",
  ),
  tests: d(
    "packages/runtime-claude/test/runtime.test.ts",
    "Tests: both drivers, against a stand-in claude",
  ),
  driver: d(
    "packages/core/src/run/driver.ts",
    "Code: which driver a session uses",
  ),
  ready: d(
    "packages/cli/src/run/ready-driver.ts",
    "Code: the driver ready on this machine, for a run",
  ),
  readyTests: d(
    "packages/cli/test/ready-driver.test.ts",
    "Tests: the ready driver, and a resume keeping its own",
  ),
  driverRule: d(
    "specs/runtime.md#which-driver-a-session-uses",
    "Spec: which driver a session uses",
  ),
  clean: d(
    "packages/runtime-claude/src/clean.ts",
    "Code: a session clean of the machine's Claude setup",
  ),
  cleanTests: d(
    "packages/runtime-claude/test/clean.test.ts",
    "Tests: clean sessions, and `--machine-claude`, on both drivers",
  ),
  loads: d(
    "specs/runtime.md#what-a-session-loads",
    "Spec: what a session loads",
  ),
  cleanAdr: d(
    "decisions/ADR-065-clean-claude-sessions.md",
    "ADR-065: Claude sessions start clean of the machine's setup",
  ),
  namedMcpAdr: d(
    "decisions/ADR-067-nodes-name-mcp-servers.md",
    "ADR-067: a node names the MCP servers it needs",
  ),
};

/** Where a node sits in a workflow, and what that means for its run. */
export const ROLES = {
  rules: d("specs/graph-compiler.md#rules", "Spec: entries, ownership, loops"),
  diagnostics: d(
    "specs/graph-compiler.md#diagnostics",
    "Spec: what `ork validate` reports",
  ),
  activations: d(
    "specs/scheduler.md#activations",
    "Spec: activations and dead paths",
  ),
  edges: d("specs/scheduler.md#edges", "Spec: when an edge is taken"),
  control: d("specs/scheduler.md#control-nodes", "Spec: split, router, join"),
  loops: d("specs/scheduler.md#loops", "Spec: loops and their bound"),
  delegation: d("specs/scheduler.md#delegation", "Spec: delegation"),
  where: d(
    "specs/worktrees.md#where-each-node-works",
    "Spec: where each node works",
  ),
  afterRun: d("specs/worktrees.md#after-the-run", "Spec: what a run leaves"),
  upstream: d(
    "packages/core/src/worktree/upstream.ts",
    "Code: where a readonly node works",
  ),
  workspace: d(
    "packages/core/src/worktree/workspace.ts",
    "Code: where each node works, `continue` too",
  ),
  continueAdr: d(
    "decisions/ADR-037-isolation-continue.md",
    "ADR-037: `isolation: continue`",
  ),
  compileTests: d(
    "packages/core/test/compile.test.ts",
    "Tests: entries, trees, unreachable nodes",
  ),
  worktreeTests: d(
    "packages/core/test/worktree.test.ts",
    "Tests: worktrees, merges, readonly nodes",
  ),
  subagent: d(
    "docs/guides/writing-workflows.md#claude-nodes",
    "Guide: Claude nodes, sub-agents",
  ),
  brief: d(
    "packages/core/src/run/brief.ts",
    "Code: a node's brief, and its sub-agents",
  ),
};
