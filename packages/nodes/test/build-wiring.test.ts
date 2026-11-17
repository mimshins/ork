/**
 * @file Pins how this repository's `build` workflow feeds its reviewers: the
 *   diff stat is computed once by `stat`, which only `build` leads to and only
 *   `review` follows, and every round (a failed review, a `revise` at the
 *   ratify gate) goes back through `build`, so `stat` runs again. The
 *   reviewers' prompt carries that output instead of telling them to run `git
 *   diff HEAD`.
 */

import { readFileSync } from "node:fs";

import { expandEdge, parseWorkflow, type Edge } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

const TEXT = readFileSync(
  new URL("../../../.ork/workflows/build.ork.yaml", import.meta.url),
  "utf8",
);

const parsedOrThrow = () => {
  const parsed = parseWorkflow(TEXT);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

/** Every edge, string and object form alike, one `from -> to` at a time. */
const edgesOrThrow = (): Edge[] =>
  (parsedOrThrow().edges ?? []).flatMap((input, source) => {
    const expanded = expandEdge(input, source);
    if (!expanded.ok) throw new Error(expanded.message);
    return expanded.edges;
  });

const into = (to: string): string[] =>
  edgesOrThrow()
    .filter(edge => edge.to === to)
    .map(edge => edge.from);

const whenOf = (from: string, to: string): (string | undefined)[] =>
  edgesOrThrow()
    .filter(edge => edge.from === from && edge.to === to)
    .map(edge => edge.when);

const promptOf = (id: string): string => {
  const node = parsedOrThrow().nodes[id];
  if (node === undefined || !("prompt" in node))
    throw new Error(`${id}: no prompt`);
  return String(node.prompt);
};

describe("build's review wiring", () => {
  it("runs `stat` after `build` and before `review`, and only there", () => {
    expect(whenOf("build", "stat")).toEqual([undefined]);
    expect(whenOf("stat", "review")).toEqual([undefined]);
    expect(into("stat")).toEqual(["build"]);
    expect(into("review")).toEqual(["stat"]);
  });

  it("goes back through `build` on a failed review and on `revise`, so `stat` runs again", () => {
    expect(whenOf("review", "build")).toEqual(["!all(statuses, 'pass')"]);
    expect(whenOf("ratify", "build")).toEqual(["choice == 'revise'"]);
  });

  it("gives the reviewers the stat output, not a `git diff HEAD` of their own", () => {
    const prompt = promptOf("review");
    expect(prompt).toContain("{{nodes.stat.output.stdout}}");
    // The prompt still says "don't run … `git diff HEAD --stat` again".
    expect(prompt).not.toMatch(/git diff HEAD(?! --stat)/u);
  });
});
