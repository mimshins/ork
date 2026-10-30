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
  milestones: d("docs/design.md#milestones", "Design: milestones"),
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
  workflow: d(
    "packages/schema/src/workflow.ts",
    "Code: the workflow and layout schema",
  ),
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
};

export const CLI = {
  validate: d("packages/cli/src/commands/validate.ts", "Code: `ork validate`"),
  init: d("packages/cli/src/commands/init.ts", "Code: `ork init`"),
  doctor: d("packages/cli/src/doctor/checks.ts", "Code: `ork doctor`'s checks"),
  tests: d("packages/cli/test/cli.test.ts", "Tests: init and validate"),
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
    "packages/cli/src/commands/control.ts",
    "Code: `ork decide` and `ork stop`",
  ),
  detach: d("packages/cli/src/run/detach.ts", "Code: `ork run --detach`"),
  cliTests: d("packages/cli/test/control.test.ts", "Tests: decide and stop"),
};

export const BUS = {
  bus: d("packages/core/src/run/bus.ts", "Code: the message bus"),
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
};

export const NODE_TYPES = {
  claude: d("packages/nodes/src/claude.ts", "Code: Claude nodes"),
  tools: d("packages/nodes/src/tools.ts", "Code: tool nodes"),
  gate: d("packages/nodes/src/gate.ts", "Code: human gates"),
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
    "Code: `ork worktrees` list and clean",
  ),
  command: d(
    "packages/cli/src/commands/worktrees.ts",
    "Code: the `ork worktrees` command",
  ),
  tests: d(
    "packages/core/test/worktree.test.ts",
    "Tests: worktrees in a real repository",
  ),
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
};
