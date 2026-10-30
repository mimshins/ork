/**
 * @file Doc links that several maps use: the sections of the design doc and the
 *   README, and the built schema package. `tools/check.mjs` checks that every
 *   path exists and that every `#anchor` matches a heading.
 */

import { d } from "./types.js";

export const DESIGN = {
  concepts: d("docs/design.md#core-concepts", "Design: core concepts"),
  packages: d(
    "docs/design.md#architecture-pnpm-monorepo",
    "Design: the packages",
  ),
  runtime: d(
    "docs/design.md#runtime-adapter-packagesruntime-claude",
    "Design: the runtime adapter and its two drivers",
  ),
  format: d(
    "docs/design.md#workflow-file-format",
    "Design: the workflow file format",
  ),
  context: d(
    "docs/design.md#context-engineering-skills-and-precedence",
    "Design: context, skills and precedence",
  ),
  messaging: d(
    "docs/design.md#messaging-decisions-logs",
    "Design: messaging, decisions and logs",
  ),
  cli: d("docs/design.md#cli-milestone-1", "Design: the CLI commands"),
  ui: d(
    "docs/design.md#ui-milestone-2-ork-ui-on-localhost",
    "Design: the UI panels",
  ),
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
};
