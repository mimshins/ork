/**
 * @file What happens when a loop runs out of rounds: the question put to the
 *   human until owners handle escalation.
 */

import type { CompiledEdge } from "../graph/types.ts";
import type { HumanChannel } from "../runtime/types.ts";

export const LOOP_CHOICES = {
  stop: "stop",
  again: "again",
  onward: "onward",
} as const;

/**
 * A loop out of rounds goes to the human until ownership (M1c slice 3) sends it
 * to the owner first. Without an answer, the recommended choice stops the run.
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
