/**
 * @file Loop rounds and what happens when a loop runs out of them: the run asks
 *   the owner of the loop's nodes while its session is live, and the human
 *   otherwise, whether to stop, allow one more round, or go on. A child that
 *   fails or runs out inside `delegate` is reported to its leader instead.
 */

import type { CompiledEdge } from "../graph/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import type { Bus, OwnerQuestion } from "./bus.ts";
import { edgeKey } from "./routing.ts";
import type { NodeOutput, RunEvent } from "./types.ts";

export const LOOP_CHOICES = {
  stop: "stop",
  again: "again",
  onward: "onward",
} as const;

/** The question about a loop out of rounds; the recommended choice stops. */
export const loopQuestion = (edge: CompiledEdge): OwnerQuestion => ({
  question: `The loop ${edge.from} -> ${edge.to} used all ${String(edge.maxRounds ?? 0)} of its rounds. What now?`,
  options: [
    { id: LOOP_CHOICES.stop, description: "Stop the run" },
    { id: LOOP_CHOICES.again, description: "Allow one more round" },
    { id: LOOP_CHOICES.onward, description: "Go on along the other edges" },
  ],
  recommended: LOOP_CHOICES.stop,
  context: `${edge.from} still wants another round${edge.when === undefined ? "" : ` (${edge.when})`}.`,
});

/**
 * Asks the owner of `edge.from` while its session is live (the node runs in the
 * flow, so its owner is not waiting on it), and the human otherwise or when the
 * owner's session ends first.
 */
export const askAboutLoop = async (
  human: HumanChannel,
  edge: CompiledEdge,
  bus?: Pick<Bus, "askOwner">,
): Promise<string> => {
  const question = loopQuestion(edge);
  const owner =
    (await bus?.askOwner(edge.from, question)) ??
    (await bus?.askOwner(edge.to, question));
  return owner ?? human.ask({ nodeId: edge.from, ...question });
};

export type LoopOptions = {
  human: HumanChannel;
  /** Asks a live owner before the human. */
  bus?: Pick<Bus, "askOwner">;
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
    const choice = await askAboutLoop(options.human, edge, options.bus);
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
