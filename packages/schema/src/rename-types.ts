/**
 * @file Rewrites a workflow file that names the node types RFC-015 renamed
 *   (`claude.worker` and the others), for `ork migrate`: the types are renamed
 *   in the YAML document, so the file keeps its comments and its own layout,
 *   and the result is checked against the workflow schema. Models and every
 *   other value are left as they are.
 */

import { isMap, isScalar, parseDocument } from "yaml";

import { RETIRED_NODE_TYPES } from "./retired-types.ts";
import { parseWorkflow, SCHEMA_URL } from "./yaml.ts";

export type TypeRename =
  | { ok: true; text: string; renamed: Record<string, number> }
  | { ok: false; reason: string };

/**
 * The file with its retired node types renamed, keeping comments and layout,
 * and with how many of each; `null` when it names none (nothing to do, so a
 * second run changes nothing). A file that, once renamed, does not validate is
 * not rewritten: `{ ok: false }` says why.
 */
export const renameNodeTypes = (text: string): TypeRename | null => {
  const doc = parseDocument(text);
  const nodes = doc.errors.length === 0 ? doc.get("nodes", true) : undefined;
  const renamed: Record<string, number> = {};
  if (isMap(nodes)) {
    for (const pair of nodes.items) {
      const type = isMap(pair.value) ? pair.value.get("type", true) : undefined;
      if (
        isScalar(type) &&
        typeof type.value === "string" &&
        Object.hasOwn(RETIRED_NODE_TYPES, type.value)
      ) {
        const old = type.value;
        type.value = RETIRED_NODE_TYPES[old] ?? old;
        renamed[old] = (renamed[old] ?? 0) + 1;
      }
    }
  }
  if (Object.keys(renamed).length === 0) {
    // A file that does not parse cannot be known to hold none.
    return doc.errors.length > 0 &&
      /claude\.(worker|leader|subagent)/u.test(text)
      ? {
          ok: false,
          reason: doc.errors[0]?.message.split("\n")[0] ?? "not YAML",
        }
      : null;
  }
  // The same options as `serializeWorkflow`, so a canonical file stays canonical.
  const body = doc.toString({ lineWidth: 0, indent: 2 });
  const parsed = parseWorkflow(body);
  if (!parsed.ok) {
    const first = parsed.diagnostics[0];
    const where =
      first?.line === undefined ? "" : `line ${String(first.line)}: `;
    return {
      ok: false,
      reason: `${where}${first?.message ?? "does not validate"}`,
    };
  }
  // The file's own text, so its comments survive; only the schema line is added.
  const header = `# yaml-language-server: $schema=${SCHEMA_URL}\n`;
  const rewritten = body.includes("yaml-language-server")
    ? body
    : header + body;
  return { ok: true, text: rewritten, renamed };
};
