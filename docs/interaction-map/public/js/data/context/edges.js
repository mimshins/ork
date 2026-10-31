/**
 * @file The context map's connections. The edges down the first column are not
 *   calls: they show precedence, each layer losing to the one below it. Lanes
 *   in use: `x` 556 and 570 between the compiler and the session spec; `x` 846
 *   and 860 between the session spec and the session.
 */

import { CONTEXT, DESIGN, RUNTIME } from "../refs.js";

/** @typedef {import("../types.js").MapEdge} MapEdge */

/**
 * A precedence step between two layers.
 *
 * @param {string} from The lower layer.
 * @param {string} to The higher layer.
 * @returns {MapEdge} The edge.
 */
const shadowedBy = (from, to) => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: "local",
  label: "shadowed by",
  detail:
    "Not a call: for a skill with the same name, the layer below this one wins and this one does not load.",
  docs: [CONTEXT.resolver, DESIGN.context],
});

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  {
    id: "builtins-user",
    from: "builtins",
    to: "user",
    kind: "local",
    label: "named by a higher layer",
    detail:
      "Not a call: a built-in skill loads only where the workflow or a node names it (`ork:<name>`), and competes at that layer.",
    docs: [CONTEXT.skills],
  },
  shadowedBy("user", "project"),
  shadowedBy("project", "workflow"),
  shadowedBy("workflow", "nodeLayer"),
  {
    id: "layers-resolver",
    from: "nodeLayer",
    to: "resolver",
    kind: "file",
    label: "every layer",
    detail:
      "The resolver reads every layer's skills and context files and keeps the highest of each skill name.",
    docs: [CONTEXT.resolver, DESIGN.context],
  },
  {
    id: "project-agents",
    from: "project",
    to: "agentsRule",
    kind: "file",
    label: "read by Claude Code",
    detail:
      "Claude Code itself reads `CLAUDE.md`, or `AGENTS.md` when there is none; Ork adds neither and only checks the version of your `claude`.",
    docs: [CONTEXT.version, DESIGN.context],
  },
  {
    id: "project-agentCatalog",
    from: "project",
    to: "agentCatalog",
    kind: "file",
    label: "agent folders",
    detail:
      "The catalog reads the agent folders of the project's tools and Ork's own, and the user's `~/.ork/agents`.",
    docs: [CONTEXT.agentCatalog, DESIGN.context],
  },
  {
    id: "agentCatalog-sysprompt",
    from: "agentCatalog",
    to: "sysprompt",
    kind: "local",
    label: "the agent's role",
    detail:
      "The agent's role becomes `# Your role: <name>` in the system prompt, after the shared layers; its settings fill the node.",
    docs: [CONTEXT.agentApply, DESIGN.context],
  },
  {
    id: "brief-assembler",
    from: "brief",
    to: "assembler",
    kind: "local",
    label: "rendered brief",
    detail:
      "Templates are rendered against the run's inputs and finished nodes' outputs.",
    docs: [DESIGN.concepts],
  },
  {
    id: "explain-resolver",
    from: "explain",
    to: "resolver",
    kind: "local",
    label: "dry run",
    detail:
      "Runs the same resolution without starting a session, and prints it.",
    docs: [DESIGN.cli],
  },
  {
    id: "resolver-assembler",
    from: "resolver",
    to: "assembler",
    kind: "local",
    label: "winning instructions",
    detail: "The context files of each layer, in order.",
  },
  {
    id: "resolver-settings",
    from: "resolver",
    to: "settings",
    kind: "local",
    label: "skills switched off",
    detail:
      "Every project skill that is shadowed or left out goes into `skillOverrides` as `off`.",
  },
  {
    id: "resolver-plugin",
    from: "resolver",
    to: "plugin",
    kind: "file",
    label: "writes the plugin",
    detail:
      "Copies the winning user, workflow and node skills into the node's plugin folder.",
  },
  {
    id: "resolver-limits",
    from: "resolver",
    to: "limits",
    kind: "local",
    label: "node over defaults",
    detail:
      "Each limit comes from the node if set, else from the workflow's `defaults`.",
    via: [
      [556, 656],
      [556, 876],
    ],
  },
  {
    id: "assembler-sysprompt",
    from: "assembler",
    to: "sysprompt",
    kind: "local",
    label: "stable prefix",
    detail:
      "The practices, the context of each layer and Ork's harness text, in a fixed order, so the same node gets the same prefix every round.",
    via: [
      [570, 740],
      [570, 416],
    ],
  },
  {
    id: "assembler-brief",
    from: "assembler",
    to: "briefMsg",
    kind: "local",
    label: "suffix",
    detail: "The only part that changes from task to task.",
  },
  {
    id: "sysprompt-session",
    from: "sysprompt",
    to: "session",
    kind: "process",
    label: "at start",
    detail: "Passed to the driver when the session starts.",
    via: [
      [846, 396],
      [846, 616],
    ],
    docs: [RUNTIME.sdk, RUNTIME.cli, DESIGN.runtime],
  },
  {
    id: "settings-session",
    from: "settings",
    to: "session",
    kind: "process",
    label: "sources · settings",
    detail:
      "`settingSources` and `settings` for the SDK, `--setting-sources` and `--settings` for the CLI.",
    docs: [DESIGN.runtime],
  },
  {
    id: "plugin-session",
    from: "plugin",
    to: "session",
    kind: "process",
    label: "`plugins` · `--plugin-dir`",
    detail: "The plugin folder, loaded like any local Claude Code plugin.",
  },
  {
    id: "brief-session",
    from: "briefMsg",
    to: "session",
    kind: "process",
    label: "first message",
    detail: "Sent after the session starts, through its input stream.",
  },
  {
    id: "limits-session",
    from: "limits",
    to: "session",
    kind: "process",
    label: "model · turns · budget",
    detail:
      "`model`, `effort`, `maxTurns`, `maxBudgetUsd` and the tool rules of the session.",
    via: [
      [860, 876],
      [860, 656],
    ],
    docs: [DESIGN.runtime],
  },
  {
    id: "session-model",
    from: "session",
    to: "model",
    kind: "net",
    label: "prefix (cached) + brief",
    detail: "Turns after the first read the prefix from the cache.",
  },
  {
    id: "session-report",
    from: "session",
    to: "report",
    kind: "process",
    label: "structured output",
    detail:
      "The session ends with its report as structured output (`outputFormat`, `--json-schema`), which the driver reads from the final result.",
    docs: [RUNTIME.report, DESIGN.runtime],
  },
  {
    id: "report-artifacts",
    from: "report",
    to: "artifacts",
    kind: "file",
    label: "big outputs, by path",
    detail:
      "Outputs over the threshold are written as artifacts; the report carries their paths.",
    status: "specified",
    docs: [DESIGN.context],
  },
];
