/**
 * @file How a session's own words and tool calls read in the transcript: the
 *   agent's text (indented plain, wrapped rich), and a tool call as `Tool first
 *   line` cut to the screen with `+N lines`, a path inside the node's worktree
 *   relative to it, or whole with `--verbose`. Untrusted text goes through
 *   `plain()` first.
 */

import { maskReplacer, TOOL_INPUT_KEYS } from "@krapht/ork-core";
import { z } from "zod";

import { previewInput } from "../human.ts";
import { plain } from "../output.ts";
import { cut, widthOf, wrap } from "../term/layout.ts";
import { styler, type View } from "./view.ts";

export const indent = (text: string): string[] =>
  text
    .trimEnd()
    .split("\n")
    .map(line => `  ${plain(line)}`);

/** Agent text under a 2-column indent, its long lines wrapped to `room`. */
export const wrapped = (text: string, room: number): string[] => {
  const width = Math.max(1, room - 2);
  return text
    .trimEnd()
    .split("\n")
    .flatMap(line => {
      const safe = plain(line).trimEnd();
      return widthOf(safe) <= width ? [safe] : wrap(safe, width);
    })
    .map(line => `  ${line}`);
};

/** Ork's `delegate` tool, as each driver names it (`mcp__ork__…`, `ork_…`). */
const DELEGATE = /(?:^|_)delegate$/u;

/** The input with every string in it masked. */
const maskedInput = (input: Record<string, unknown>): Record<string, unknown> =>
  z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(JSON.stringify(input, maskReplacer)));

/** A tool's input as the call says it: the key that names its target, whole. */
const toolText = (input: Record<string, unknown>, root?: string): string => {
  const key = TOOL_INPUT_KEYS.find(k => typeof input[k] === "string");
  const text = key === undefined ? JSON.stringify(input) : String(input[key]);
  if (root === undefined) return text;
  const base = root.replace(/\/+$/u, "");
  // A path inside the node's worktree reads relative to it.
  return text === base ? "." : text.replaceAll(`${base}/`, "");
};

/**
 * A tool call: rich, `Tool first line` cut to `room` with `+N lines` when it
 * had more; plain, today's one dim line. `verbose` shows the call whole.
 */
export const toolLines = (
  name: string,
  raw: Record<string, unknown>,
  view: View,
  room: number,
  verbose: boolean,
  node: string,
): string[] => {
  // A delegate call's task labels are masked, as its children's are; before any cut.
  const input = DELEGATE.test(name) ? maskedInput(raw) : raw;
  const { term } = view;
  const style = styler(term);
  if (!term.rich && !verbose) {
    return [style("dim", `  · ${plain(previewInput(name, input))}`)];
  }
  const label = plain(name);
  const text = toolText(input, view.roots.get(node));
  const [first = "", ...rest] = text
    .trimEnd()
    .split("\n")
    .map(line => plain(line));
  const lead = term.rich ? "  " : "  · ";
  const sep = term.rich ? "  " : " ";
  const headWidth = widthOf(lead) + widthOf(label) + sep.length;
  const styledHead = `${style("dim", lead)}${style("bold", label)}${style("dim", sep)}`;
  if (verbose) {
    const pad = " ".repeat(headWidth);
    return [
      `${styledHead}${style("dim", first)}`,
      ...rest.map(line => style("dim", `${pad}${line}`)),
    ];
  }
  const more =
    rest.length === 0
      ? ""
      : ` +${String(rest.length)} ${rest.length === 1 ? "line" : "lines"}`;
  const fit = cut(first.trim(), Math.max(1, room - headWidth - more.length));
  return [`${styledHead}${style("dim", fit)}${style("dim", more)}`];
};
