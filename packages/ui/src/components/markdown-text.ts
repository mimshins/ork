/**
 * @file What a decision's text means as Markdown, apart from how it is drawn:
 *   the tree the parser gives, the one rule for which link targets are links,
 *   and a text's plain first line. Decision text is untrusted (a model's
 *   report, a file's content), so this reads it as a tree and nothing else: no
 *   HTML string is ever made from it (ADR-069).
 */

import type { Nodes, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

/** The only targets a link may have; any other shows as text. */
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Whether a target is one a person may follow: absolute and allow-listed. */
export const isAllowedLink = (target: string): boolean => {
  try {
    return LINK_PROTOCOLS.has(new URL(target).protocol);
  } catch {
    return false;
  }
};

/** How deep blocks may nest: deeper text is drawn as written, not recursed. */
const MAX_NESTING = 50;

/** The deepest nesting under a node, found without recursion. */
const nestingOf = (root: Nodes): number => {
  let deepest = 0;
  const stack: { node: Nodes; depth: number }[] = [{ node: root, depth: 0 }];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    deepest = Math.max(deepest, next.depth);
    if ("children" in next.node) {
      for (const child of next.node.children) {
        stack.push({ node: child, depth: next.depth + 1 });
      }
    }
  }
  return deepest;
};

/**
 * The text as a tree, the parser's own and the base grammar only. Text nested
 * past `MAX_NESTING` throws, so every walk of the tree below is shallow.
 */
export const parseMarkdown = (text: string): Root => {
  const tree = fromMarkdown(text);
  if (nestingOf(tree) > MAX_NESTING) throw new RangeError("Nested too deep");
  return tree;
};

/** A node's own words, or those of what is in it, in order. */
export const plainOf = (node: Nodes): string => {
  if (node.type === "break") return "\n";
  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(plainOf).join("") : "";
};

/** Where block-level nodes sit: a raw-HTML node in one is a block. */
export const FLOW_PARENTS: readonly string[] = [
  "root",
  "blockquote",
  "listItem",
];

/** Every code block (fenced, indented or raw HTML block) under a node. */
export const countBlocks = (node: Nodes): number => {
  if (!("children" in node)) return 0;
  return node.children.reduce<number>((total, child: RootContent) => {
    const own =
      child.type === "code" ||
      (child.type === "html" && FLOW_PARENTS.includes(node.type))
        ? 1
        : 0;
    return total + own + countBlocks(child);
  }, 0);
};

/** A text's first line as plain words, cut at `max` with `…`. */
export const firstLineOf = (text: string, max = 120): string => {
  const cut = (line: string): string => {
    const words = line.trim();
    return words.length > max ? `${words.slice(0, max - 1)}…` : words;
  };
  try {
    const first: RootContent | undefined = parseMarkdown(text).children.find(
      child => plainOf(child).trim() !== "",
    );
    return cut(
      plainOf(first ?? { type: "text", value: "" })
        .split("\n")
        .find(each => each.trim() !== "") ?? "",
    );
  } catch {
    // Text that cannot be read as Markdown: its first line as written.
    return cut(text.split("\n").find(each => each.trim() !== "") ?? "");
  }
};

/** How many lines a text has as written, for where nothing can be measured. */
export const linesOf = (text: string): number =>
  text === "" ? 0 : text.replace(/\n+$/u, "").split("\n").length;
