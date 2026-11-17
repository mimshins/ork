/**
 * @file What `ork __onboard finish` holds a written workflow to, as pure
 *   functions of the parsed file: the dollar and token caps, no `driver` or
 *   `model`, no agents of its own, and the list of what the person should look
 *   at (a new allow rule, `env` entry or network reach). Specs:
 *   specs/cli/onboard-verbs.md#finish.
 */

import type { Project, Workflow } from "@krapht/ork-schema";

/** The agents a written workflow may name: Ork's built-in two. */
export const ALLOWED_AGENTS: readonly string[] = [
  "ork-implementer",
  "ork-reviewer",
];

/** The node types that reach a network service Ork does not run. */
const NETWORK_NODES = new Set(["tool.gh", "tool.aws", "mcp.call"]);

type Fields = Record<string, unknown>;

const fieldsOf = (value: unknown): Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

const textsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const allowText = (rule: string): string =>
  `allows \`${rule}\`${/^Web(?:Fetch|Search)\b/u.test(rule) ? " (network)" : ""}`;

/** The built-in tools that only read the project; every other name is listed. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);

/** Whether an allow rule is a read-only tool; a rule of unknown shape is not. */
const readsOnly = (rule: string): boolean => {
  const name = /^([A-Za-z]+)(?:\(.*\))?$/u.exec(rule.trim())?.[1];
  return name !== undefined && READ_TOOLS.has(name);
};

const allowsOf = (value: unknown): string[] =>
  textsOf(fieldsOf(value)["allow"]).filter(rule => !readsOnly(rule));

/** One line per field that is set; a changed value reads as a new line. */
const fieldChanges = (
  at: string,
  fields: readonly (readonly [string, unknown])[],
): string[] =>
  fields.flatMap(([name, value]) =>
    value === undefined
      ? []
      : [`${at} changes \`${name}\` to \`${JSON.stringify(value)}\``],
  );

/** The messages for a workflow's missing caps, `driver`, `model` and agents. */
export const workflowProblems = (workflow: Workflow): string[] => {
  const problems: string[] = [];
  if (workflow.limits?.budgetUsd === undefined) {
    problems.push("limits.budgetUsd is missing");
  }
  if (workflow.limits?.budgetTokens === undefined) {
    problems.push("limits.budgetTokens is missing");
  }
  const places: [string, Fields][] = [
    ["defaults", fieldsOf(workflow.defaults)],
    ...Object.entries(fieldsOf(workflow.agents)).map(
      ([name, agent]): [string, Fields] => [`agent ${name}`, fieldsOf(agent)],
    ),
    ...Object.entries(workflow.nodes).map(([id, node]): [string, Fields] => [
      `node ${id}`,
      fieldsOf(node),
    ]),
  ];
  for (const [place, fields] of places) {
    for (const key of ["driver", "model"]) {
      if (fields[key] !== undefined) {
        problems.push(
          `${place} sets \`${key}\`; leave it to the person running it`,
        );
      }
    }
  }
  const own = Object.keys(fieldsOf(workflow.agents));
  if (own.length > 0) {
    problems.push(
      `defines agents of its own (${own.join(", ")}); use ${ALLOWED_AGENTS.join(" or ")}`,
    );
  }
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const agent = fieldsOf(node)["agent"];
    if (typeof agent === "string" && !ALLOWED_AGENTS.includes(agent)) {
      problems.push(
        `node ${id} uses agent \`${agent}\`; use ${ALLOWED_AGENTS.join(" or ")}`,
      );
    }
  }
  return problems;
};

/** What a workflow gives a session beyond reading: allows, env and network. */
export const eyeOfWorkflow = (workflow: Workflow): string[] => {
  const items: string[] = [];
  for (const rule of allowsOf(fieldsOf(workflow.rules)["permissions"])) {
    items.push(`rules ${allowText(rule)}`);
  }
  items.push(
    ...fieldChanges("workflow", [
      ["context", workflow.layers?.context],
      ["rules.git", workflow.rules?.git],
      ["rules.links", workflow.rules?.links],
      ["defaults.isolation", workflow.defaults?.isolation],
    ]),
  );
  for (const server of textsOf(workflow.defaults?.mcp)) {
    items.push(`defaults load MCP server \`${server}\``);
  }
  for (const [id, node] of Object.entries(workflow.nodes)) {
    const fields = fieldsOf(node);
    const at = `node ${id}`;
    for (const rule of allowsOf(fields["tools"])) {
      items.push(`${at} ${allowText(rule)}`);
    }
    items.push(
      ...fieldChanges(at, [
        ["context", fields["context"]],
        ["isolation", fields["isolation"]],
        ["tools.only", fieldsOf(fields["tools"])["only"]],
      ]),
    );
    for (const key of Object.keys(fieldsOf(fields["env"]))) {
      items.push(`${at} sets env \`${key}\``);
    }
    for (const step of ["before", "verify"]) {
      for (const key of Object.keys(fieldsOf(fieldsOf(fields[step])["env"]))) {
        items.push(`${at} ${step} sets env \`${key}\``);
      }
    }
    for (const server of textsOf(fields["mcp"])) {
      items.push(`${at} loads MCP server \`${server}\``);
    }
    if (NETWORK_NODES.has(node.type)) {
      items.push(`${at} is a ${node.type} node (network)`);
    }
  }
  return items;
};

/** What `.ork/project.yaml` gives every workflow beyond reading. */
export const eyeOfProject = (project: Project): string[] => [
  ...allowsOf(project.permissions).map(
    rule => `project rules ${allowText(rule)}`,
  ),
  ...fieldChanges("project", [
    ["context", project.context],
    ["heavy", project.heavy],
    ["calls.accept", project.calls?.accept],
    ["followUps.file", project.followUps?.file],
    ["rules.git", project.git],
    ["rules.links", project.links],
    ["defaults.isolation", project.defaults?.isolation],
  ]),
  ...["driver", "model"].flatMap(key => {
    const value = fieldsOf(project.defaults)[key];
    return value === undefined
      ? []
      : [`project defaults set \`${key}\` for every workflow`];
  }),
  ...textsOf(project.defaults?.mcp).map(
    server => `project defaults load MCP server \`${server}\``,
  ),
];

/** The items of `now` that `before` did not have. */
export const newItems = (
  now: readonly string[],
  before: readonly string[],
): string[] => [...new Set(now)].filter(item => !before.includes(item));

/** A field `before` set (`X changes \`f\` to …`) that `now` no longer sets. */
export const removedItems = (
  now: readonly string[],
  before: readonly string[],
): string[] => [
  ...new Set(
    before.flatMap(item => {
      // The prefix has no backtick, so it cannot reach into a JSON value.
      const head = /^([^`]*? changes `[^`]+`) to /u.exec(item)?.[1];
      return head === undefined || now.some(i => i.startsWith(`${head} to `))
        ? []
        : [head.replace(" changes ", " removes ")];
    }),
  ),
];

/**
 * `removed` (the `removes` items of `removedItems`) with the items of a deleted
 * node replaced by one `node <id> removed` line; a deleted node with no listed
 * field gives none.
 */
export const collapseRemovedNodes = (
  removed: readonly string[],
  deletedNodes: readonly string[],
): string[] => {
  const gone = deletedNodes.filter(id =>
    removed.some(item => item.startsWith(`node ${id} removes `)),
  );
  return [
    ...removed.filter(
      item => !gone.some(id => item.startsWith(`node ${id} removes `)),
    ),
    ...gone.map(id => `node ${id} removed`),
  ];
};
