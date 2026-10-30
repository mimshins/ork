/**
 * @file Loop rounds and what happens when a loop runs out of them: the run asks
 *   the human whether to stop, allow one more round, or go on. A child that
 *   fails or runs out inside `delegate` is reported to its leader instead.
 */

import type { CompiledEdge } from "../graph/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import { edgeKey } from "./routing.ts";
import type { NodeOutput, RunEvent } from "./types.ts";

export const LOOP_CHOICES = {
  stop: "stop",
  again: "again",
  onward: "onward",
} as const;

/**
 * A loop out of rounds goes to the human: its owner, if it has one, is not in a
 * session to ask (a delegated run follows no edges). Without an answer, the
 * recommended choice stops the run.
 */
export const askAboutLoop = (
  human: HumanChannel,
  edge: CompiledEdge,
): Promise<string> =>
  human.ask({
    nodeId: edge.from,
    question: `The loop ${edge.from} -> ${edge.to} used all ${String(edge.maxRounds ?? 0)} of its rounds. What now?`,
    options: [
      { id: LOOP_CHOICES.stop, description: "Stop the run" },
      { id: LOOP_CHOICES.again, description: "Allow one more round" },
      { id: LOOP_CHOICES.onward, description: "Go on along the other edges" },
    ],
    recommended: LOOP_CHOICES.stop,
    context: `${edge.from} still wants another round${edge.when === undefined ? "" : ` (${edge.when})`}.`,
  });

export type LoopOptions = {
  human: HumanChannel;
  onEvent: (event: RunEvent) => void;
  /** Activates the loop's target with the output that sent it back. */
  activate: (id: string, input: NodeOutput) => void;
  /** Stops the run when the human says so. */
  fail: (reason: string) => void;
};

/** Counts each loop edge's rounds; `take` is false once one is out of them. */
export const createLoops = (options: LoopOptions) => {
  const taken = new Map<string, number>();
  const extra = new Map<string, number>();

  const take = async (
    edge: CompiledEdge,
    output: NodeOutput,
  ): Promise<boolean> => {
    const key = edgeKey(edge);
    const count = taken.get(key) ?? 0;
    if (count < (edge.maxRounds ?? 0) + (extra.get(key) ?? 0)) {
      taken.set(key, count + 1);
      options.activate(edge.to, output);
      options.onEvent({ type: "edge.taken", from: edge.from, to: edge.to });
      return true;
    }
    options.onEvent({
      type: "loop.exhausted",
      from: edge.from,
      to: edge.to,
      maxRounds: edge.maxRounds ?? 0,
    });
    const choice = await askAboutLoop(options.human, edge);
    if (choice === LOOP_CHOICES.again) {
      extra.set(key, (extra.get(key) ?? 0) + 1);
      return take(edge, output);
    }
    if (choice !== LOOP_CHOICES.onward) {
      options.fail(`the loop ${edge.from} -> ${edge.to} ran out of rounds`);
    }
    return false;
  };

  return { take };
};
