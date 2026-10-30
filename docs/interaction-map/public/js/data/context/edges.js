/**
 * @file The context map's connections. The edges down the first column are not
 *   calls: they show precedence, each layer losing to the one below it. Lanes
 *   in use: `x` 556 and 570 between the compiler and the session spec; `x` 846
 *   and 860 between the session spec and the session.
 */

import { DESIGN } from "../refs.js";

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
    "Not a call: for a skill with the same name, or an instruction that conflicts, the layer below this one wins and this one is dropped.",
  status: "specified",
  docs: [DESIGN.context],
});

/** @type {ReadonlyArray<MapEdge>} */
export const EDGES = [
  shadowedBy("builtins", "user"),
  shadowedBy("user", "project"),
  shadowedBy("project", "workflow"),
  shadowedBy("workflow", "nodeLayer"),
  {
    id: "layers-resolver",
    from: "nodeLayer",
    to: "resolver",
    kind: "file",
    label: "all five layers",
    detail:
      "The resolver reads every layer's skills and instructions and keeps the highest of each name.",
    status: "specified",
    docs: [DESIGN.context],
  },
  {
    id: "project-agents",
    from: "project",
    to: "agentsRule",
    kind: "file",
    label: "is there a CLAUDE.md?",
    detail:
      "Checks the working directory and its parents for `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md`.",
    status: "specified",
    docs: [DESIGN.context],
  },
  {
    id: "brief-assembler",
    from: "brief",
    to: "assembler",
    kind: "local",
    label: "rendered brief",
    detail:
      "Templates are rendered against the run's inputs and finished nodes' outputs.",
    status: "specified",
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
    status: "specified",
    docs: [DESIGN.cli],
  },
  {
    id: "resolver-assembler",
    from: "resolver",
    to: "assembler",
    kind: "local",
    label: "winning instructions",
    detail: "The instructions and context files that survived precedence.",
    status: "specified",
  },
  {
    id: "resolver-settings",
    from: "resolver",
    to: "settings",
    kind: "local",
    label: "skill allow-list",
    detail: "Every project skill that is ignored or shadowed is left out.",
    status: "specified",
  },
  {
    id: "resolver-plugin",
    from: "resolver",
    to: "plugin",
    kind: "file",
    label: "writes the plugin",
    detail:
      "Copies the winning Ork, user, workflow and node skills into the run's plugin directory.",
    status: "specified",
  },
  {
    id: "resolver-limits",
    from: "resolver",
    to: "limits",
    kind: "local",
    label: "node over defaults",
    detail:
      "Each limit comes from the node if set, else from the workflow's `defaults`.",
    status: "specified",
    via: [
      [556, 656],
      [556, 876],
    ],
  },
  {
    id: "agents-sysprompt",
    from: "agentsRule",
    to: "sysprompt",
    kind: "local",
    label: "AGENTS.md, if needed",
    detail:
      "Added once, only when the repo has `AGENTS.md` and no `CLAUDE.md`.",
    status: "specified",
    docs: [DESIGN.context],
  },
  {
    id: "assembler-sysprompt",
    from: "assembler",
    to: "sysprompt",
    kind: "local",
    label: "stable prefix",
    detail:
      "Workflow context and node instructions, in a fixed order, so the same node gets the same prefix every round.",
    status: "specified",
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
    status: "specified",
  },
  {
    id: "sysprompt-session",
    from: "sysprompt",
    to: "session",
    kind: "process",
    label: "at start",
    detail: "Passed to the driver when the session starts.",
    status: "specified",
    via: [
      [846, 396],
      [846, 616],
    ],
    docs: [DESIGN.runtime],
  },
  {
    id: "settings-session",
    from: "settings",
    to: "session",
    kind: "process",
    label: "setting sources",
    detail: "`settingSources` for the SDK, `--setting-sources` for the CLI.",
    status: "specified",
    docs: [DESIGN.runtime],
  },
  {
    id: "plugin-session",
    from: "plugin",
    to: "session",
    kind: "process",
    label: "`plugins`",
    detail: "The plugin directory, loaded like any local Claude Code plugin.",
    status: "specified",
  },
  {
    id: "brief-session",
    from: "briefMsg",
    to: "session",
    kind: "process",
    label: "first message",
    detail: "Sent after the session starts, through its input stream.",
    status: "specified",
  },
  {
    id: "limits-session",
    from: "limits",
    to: "session",
    kind: "process",
    label: "model · turns · budget",
    detail:
      "`model`, `maxTurns`, `maxBudgetUsd` and the tool rules of the session.",
    status: "specified",
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
    status: "specified",
  },
  {
    id: "session-report",
    from: "session",
    to: "report",
    kind: "mcp",
    label: "`report`",
    detail: "The session ends its task by calling Ork's `report` tool.",
    status: "specified",
    docs: [DESIGN.messaging],
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
