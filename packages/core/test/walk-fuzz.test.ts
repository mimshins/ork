/**
 * @file Holds what a walk claims to what the real scheduler does (RFC-009), on
 *   small random workflows: no node it says never runs may run, and no loop it
 *   says only its rounds can end may be left another way. `ORK_FUZZ_COUNT`
 *   tries more of them, and `ORK_FUZZ_SEED` others.
 */

import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  type CompiledGraph,
  compileWorkflow,
  walkWorkflow,
} from "../src/index.ts";
import {
  explore,
  falseClaims,
  randomFrom,
  randomWorkflow,
} from "./fixtures/walk-fuzz.ts";

const COUNT = Number(process.env["ORK_FUZZ_COUNT"] ?? 500);
const SEED = Number(process.env["ORK_FUZZ_SEED"] ?? 2026);
const ORDERS = [0, 1, 2, 3];
const MOST_PATHS = 1500;

const graphOf = (yaml: string): CompiledGraph | null => {
  const parsed = parseWorkflow(yaml);
  return parsed.ok ? compileWorkflow(parsed.workflow).graph : null;
};

/** What it found wrong with one workflow, and how many claims it had to judge. */
const judge = async (
  yaml: string,
): Promise<{ claims: number; wrong: string[] }> => {
  const graph = graphOf(yaml);
  if (graph === null) return { claims: 0, wrong: [] };
  const walk = await walkWorkflow(graph, { maxMs: 500 });
  if (!walk.complete || walk.findings.length === 0) {
    return { claims: 0, wrong: [] };
  }
  const reached = await Promise.all(
    ORDERS.map(order => explore(graph, order, MOST_PATHS)),
  );
  const wrong = reached.flatMap(seen => falseClaims(walk, seen));
  return {
    claims: walk.findings.length,
    wrong: wrong.map(claim => `${claim}\n${yaml}`),
  };
};

describe("what a walk claims", () => {
  it("holds on the real scheduler", async () => {
    const random = randomFrom(SEED);
    const wrong: string[] = [];
    let claims = 0;
    for (let tried = 0; tried < COUNT; tried += 1) {
      // One at a time, as each explores on the same event loop.
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      const judged = await judge(randomWorkflow(random));
      claims += judged.claims;
      wrong.push(...judged.wrong);
    }
    expect(wrong).toEqual([]);
    // A fuzz with nothing to judge would pass whatever a walk did.
    expect(claims).toBeGreaterThan(COUNT / 25);
  }, 120_000);
});
