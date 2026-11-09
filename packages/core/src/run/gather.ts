/**
 * @file A node's `output.gather` fields kept across its rounds: each round's
 *   entries are added to what the earlier rounds reported, in order, with exact
 *   repeats left out, so a leader that reports only what a fix round decided
 *   doesn't lose what it decided before. Applying it again to a replayed round
 *   changes nothing, so a resumed run gives the same lists.
 */

import type { Node } from "@krapht/ork-schema";

import { gatheredFieldsOf } from "../graph/types.ts";
import type { Activation, Replay } from "./handle.ts";
import type { NodeOutput, NodeResult } from "./types.ts";

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** `before` then `now`, leaving out an entry already there. */
const joined = (before: unknown, now: unknown): unknown[] => {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const entry of [...asList(before), ...asList(now)]) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
};

/**
 * `result` with each gathered field holding every round's entries so far.
 * `previous` is the node's output from its last round, already gathered.
 */
export const joinRounds = (
  fields: readonly string[],
  previous: NodeOutput | undefined,
  result: NodeResult,
): NodeResult => {
  if (fields.length === 0 || previous === undefined) return result;
  const output: NodeOutput = { ...result.output };
  for (const field of fields) {
    output[field] = joined(previous[field], result.output[field]);
  }
  return { ...result, output };
};

/** `result` with `node`'s `output.gather` fields joined to its earlier rounds. */
export const gatherRounds = (
  node: Node | undefined,
  previous: NodeOutput | undefined,
  result: NodeResult,
): NodeResult => joinRounds(gatheredFieldsOf(node), previous, result);

/**
 * What `activation`'s rounds reported so far, to gather onto. A spawned
 * instance gathers nothing earlier: its id (`impl-2`) is reused by a different
 * worker in the leader's next round. A delegated child that hasn't run since a
 * resume starts from what it reported before it, since its leader's recorded
 * rounds are handed back whole and never run it again.
 */
export const previousOf = (
  activation: Pick<Activation, "id" | "brief" | "template">,
  current: NodeOutput | undefined,
  replay: Replay | undefined,
): NodeOutput | undefined => {
  const { brief, template, id } = activation;
  if (brief !== undefined && template !== undefined) return undefined;
  if (current !== undefined || brief === undefined) return current;
  return replay?.lastOutput?.(id);
};

/** Gathers each activation's result onto what its node reported before. */
export const createGatherer =
  (
    outputs: Readonly<Record<string, NodeOutput>>,
    replay: Replay | undefined,
    nodeOf: (activation: Activation) => Node | undefined,
  ) =>
  (activation: Activation, result: NodeResult): NodeResult =>
    gatherRounds(
      nodeOf(activation),
      previousOf(activation, outputs[activation.id], replay),
      result,
    );
