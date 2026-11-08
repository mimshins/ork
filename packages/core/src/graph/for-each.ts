/**
 * @file The checks on `forEach` (RFC-013): where its list comes from, and where
 *   `{{item}}` and `{{index}}` may be read and what `{{item.<field>}}` may
 *   name.
 */

import type {
  Diagnostic,
  DiagnosticPath,
  Node,
  Workflow,
} from "@krapht/ork-schema";

import { ITEM_ROOTS, parseTemplate, templatePath } from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";
import { ancestorsOf } from "./flow.ts";
import { checkPlace } from "./for-each-place.ts";
import { checkAbsolute, describePath } from "./ref-paths.ts";
import { type NodeSays, nodeSays } from "./says.ts";
import { ownersOf } from "./tree.ts";
import { type CompiledEdge, forEachOf } from "./types.ts";

type Segments = readonly (string | number)[];

/** Where `{{item}}` may be read: the fields an item has, `undefined` if unknown. */
export type ItemScope = { fields: readonly string[] | undefined };

export const isItemRoot = (root: string | number | undefined): boolean =>
  (ITEM_ROOTS as readonly (string | number | undefined)[]).includes(root);

/**
 * Nodes whose output exists before `id` runs: its flow ancestors and its
 * owners'.
 */
export const upstreamOf = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  id: string,
): Set<string> => {
  const upstream = ancestorsOf(id, edges);
  for (const owner of ownersOf(workflow, id)) {
    upstream.add(owner);
    for (const ancestor of ancestorsOf(owner, edges)) upstream.add(ancestor);
  }
  return upstream;
};

/** The field a path under `nodes.<id>.output` reads, as `says.ts` names it. */
const fieldOfPath = (segments: Segments): string => segments.slice(3).join(".");

const isList = (said: NodeSays["fields"][number]): boolean =>
  said.items !== undefined || said.kind === "statuses";

/** What a node's `from` list's items have, or `undefined` if nothing says. */
const sourceFields = (
  segments: Segments,
  says: Readonly<Record<string, NodeSays>>,
): readonly string[] | undefined => {
  const [root, id] = segments;
  if (root !== "nodes") return undefined;
  const said = says[String(id)]?.fields.find(
    ({ field }) => field === fieldOfPath(segments),
  );
  return said?.items === undefined || said.items.length === 0
    ? undefined
    : said.items.map(({ field }) => field);
};

/**
 * The fields every item of a node has, for `{{item.<field>}}`: a static list's
 * common keys (none for entries that aren't objects), or the shape the source
 * declares. `undefined` where nothing says, so nothing is checked.
 */
export const itemFieldsOf = (
  node: Node,
  says: Readonly<Record<string, NodeSays>>,
): readonly string[] | undefined => {
  const each = forEachOf(node);
  if (each === undefined) return undefined;
  if ("items" in each) {
    const keys = each.items.map(entry =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
        ? Object.keys(entry)
        : [],
    );
    const [first = []] = keys;
    return first.filter(key => keys.every(own => own.includes(key)));
  }
  const path = templatePath(each.from);
  return path === null ? undefined : sourceFields(path, says);
};

/**
 * Checks one read of `item` or `index`: outside a fanned node, or a field it
 * lacks.
 */
export const checkItemRead = (
  segments: Segments,
  scope: ItemScope | undefined,
  path: DiagnosticPath,
): Diagnostic[] => {
  const [root, field] = segments;
  if (scope === undefined) {
    return [
      error(
        "item.outside",
        `\`${describePath(segments)}\`: \`item\` and \`index\` are read only in the \`prompt\`, \`command\`, \`arguments\`, \`inputs\`, \`env\` and \`ref\` of a node with \`forEach\``,
        path,
      ),
    ];
  }
  if (root !== "item" || field === undefined || scope.fields === undefined) {
    return [];
  }
  return scope.fields.includes(String(field))
    ? []
    : [
        error(
          "item.field",
          `\`${describePath(segments)}\`: an item ${scope.fields.length === 0 ? "has no fields" : `has \`${scope.fields.join("`, `")}\``}`,
          path,
        ),
      ];
};

/** `item` or `index` in a list of names a session reads as files, not templates. */
const checkFiles = (
  id: string,
  key: "context" | "skills",
  files: readonly string[],
): Diagnostic[] =>
  files.flatMap((file, index) => {
    const parsed = parseTemplate(file);
    return parsed.ok
      ? parsed.parts.flatMap(part =>
          typeof part === "string"
            ? []
            : collectPaths(part.expr)
                .filter(([root]) => isItemRoot(root))
                .flatMap(segments =>
                  checkItemRead(segments, undefined, ["nodes", id, key, index]),
                ),
        )
      : [];
  });

/** The source of one `from`: it exists, runs first, and is a declared list. */
const checkSource = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
  says: Readonly<Record<string, NodeSays>>,
  id: string,
  segments: Segments,
  path: DiagnosticPath,
): Diagnostic[] => {
  const named = describePath(segments);
  const missing = checkAbsolute(segments, { workflow, edges }, path).filter(
    ({ severity }) => severity === "error",
  );
  if (missing.length > 0) return missing;
  const [root, source] = segments;
  if (root !== "nodes") {
    return [
      error(
        "forEach.not-list",
        `\`${named}\` is not a list: workflow inputs are text`,
        path,
      ),
    ];
  }
  // The first activation needs it, so a loop back or an owner still running
  // doesn't count.
  const first = edges.filter(edge => edge.maxRounds === undefined);
  if (source === id || !ancestorsOf(id, first).has(String(source))) {
    return [
      error(
        "forEach.order",
        `\`${named}\`: \`${String(source)}\` does not run before \`${id}\`, so its list can't exist when \`${id}\` starts`,
        path,
      ),
    ];
  }
  const field = fieldOfPath(segments);
  const said = says[String(source)]?.fields.find(
    ({ field: name }) => name === field,
  );
  if (field === "" || (said !== undefined && !isList(said))) {
    return [
      error(
        "forEach.not-list",
        `\`${named}\` is not a list: \`${String(source)}\` declares ${field === "" ? "its whole output" : `\`${field}\``} as something else; declare it as \`{ list: { … } }\``,
        path,
      ),
    ];
  }
  return said === undefined
    ? [
        warning(
          "forEach.undeclared",
          `\`${named}\`: nothing declares this list, so a run can't check it or its items; add \`{ list: { … } }\` to \`${String(source)}\`'s \`output.schema\``,
          path,
        ),
      ]
    : [];
};

/** Every `forEach`'s source, and `{{item}}` in the lists no template reads. */
export const checkForEach = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): Diagnostic[] => {
  const says = nodeSays(workflow.nodes, edges);
  return Object.entries(workflow.nodes).flatMap(([id, node]) => {
    const files = (
      "context" in node ? checkFiles(id, "context", node.context ?? []) : []
    ).concat(
      "skills" in node ? checkFiles(id, "skills", node.skills ?? []) : [],
    );
    const each = forEachOf(node);
    if (each === undefined) return files;
    const placed = files.concat(
      checkPlace(workflow, edges, id, node, each.maxParallel),
    );
    if ("items" in each) return placed;
    const path = ["nodes", id, "forEach", "from"];
    const segments = templatePath(each.from);
    const found =
      segments === null
        ? [
            error(
              "forEach.from-path",
              `\`from\` must be exactly one path, such as \`{{nodes.plan.output.tasks}}\`, not \`${each.from}\``,
              path,
            ),
          ]
        : checkSource(workflow, edges, says, id, segments, path);
    return placed.concat(found);
  });
};

/**
 * Where each node may read `{{item}}`, as a function for the templates that
 * can: only a fanned node has a scope, `allowed` is false for the templates
 * that may not read it (`instructions`, `cwd`, `before:`…).
 */
export const itemScopes = (
  workflow: Workflow,
  edges: readonly CompiledEdge[],
): ((id: string, allowed?: boolean) => { item?: ItemScope }) => {
  const says = nodeSays(workflow.nodes, edges);
  return (id, allowed = true) => {
    const node = workflow.nodes[id];
    return allowed && node !== undefined && forEachOf(node) !== undefined
      ? { item: { fields: itemFieldsOf(node, says) } }
      : {};
  };
};
