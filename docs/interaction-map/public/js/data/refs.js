/**
 * @file Doc links that several maps use: the sections of the design doc and the
 *   README, and the built schema package. `tools/check.mjs` checks that every
 *   path exists and that every `#anchor` matches a heading.
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
  feedback: d("specs/feedback.md", "Spec: feedback and self-improvement"),
  cli: d("specs/cli.md", "Spec: the CLI commands"),
  scheduler: d("specs/scheduler.md", "Spec: running a workflow"),
  worktrees: d("specs/worktrees.md", "Spec: worktrees, where nodes work"),
  ui: d("specs/ui.md", "Spec: the UI panels"),
  milestones: d("docs/design.md#milestones", "Design: milestones"),
};

export const README = {
  accounts: d(
    "README.md#your-accounts-your-machine",
    "README: your accounts, your machine",
  ),
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

export const ENGINE = {
  scheduler: d("packages/core/src/run/scheduler.ts", "Code: the scheduler"),
  routing: d(
    "packages/core/src/run/routing.ts",
    "Code: edges, joins, routers and dead paths",
  ),
  tests: d("packages/core/test/scheduler.test.ts", "Tests: the scheduler"),
};

export const NODE_TYPES = {
  claude: d("packages/nodes/src/claude.ts", "Code: Claude nodes"),
  tools: d("packages/nodes/src/tools.ts", "Code: tool nodes"),
  gate: d("packages/nodes/src/gate.ts", "Code: human gates"),
  tests: d("packages/nodes/test/nodes.test.ts", "Tests: the node types"),
};

export const PRACTICES = {
  code: d(
    "packages/core/src/practices/index.ts",
    "Code: the built-in practices",
  ),
  tests: d(
    "packages/core/test/practices.test.ts",
    "Tests: practices and their cascade",
  ),
  spec: d("specs/context.md#built-in-practices", "Spec: built-in practices"),
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
  tools: d("packages/runtime-claude/src/tools.ts", "Code: Ork's tools"),
  tests: d(
    "packages/runtime-claude/test/runtime.test.ts",
    "Tests: both drivers, against a stand-in claude",
  ),
};
