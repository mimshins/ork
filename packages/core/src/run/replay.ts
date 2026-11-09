/**
 * @file Handing a resumed run's record back (ADR-026): each node's results in
 *   order until it runs anew, a cut-off node's session once, loop answers in
 *   order, and for a fanned node (RFC-013) its recorded list and each item's
 *   results by item id and round, so items finishing in any order get their own
 *   back.
 */

import type { HumanChannel } from "../runtime/types.ts";
import type { EarlierSpend } from "../usage/spend.ts";
import type { Mail } from "./bus-events.ts";
import type { Activation, Replay } from "./handle.ts";
import { listKey, type RecordedFanOuts } from "./resume.ts";
import type { NodeOutput, NodeResult } from "./types.ts";

const NO_FAN_OUTS: RecordedFanOuts = { lists: new Map(), items: new Map() };

/** Whether an activation's input carries a result this run made anew. */
const carries = (fresh: WeakSet<object>, input: NodeOutput | undefined) => {
  if (input === undefined) return false;
  if (fresh.has(input)) return true;
  // A join's input holds each of its inputs' outputs.
  const results = input["results"];
  if (results === null || typeof results !== "object") return false;
  const values: unknown[] = Object.values(results);
  return values.some(
    value => value !== null && typeof value === "object" && fresh.has(value),
  );
};

/**
 * Hands each node's recorded results back in order, until the node runs anew
 * once (it failed or never finished last time, or its input is new); from then
 * on it always runs. A node cut off mid-session continues that session, once.
 */
export const createReplay = (
  history: ReadonlyMap<string, readonly NodeResult[]>,
  cutOff: ReadonlyMap<string, string> = new Map(),
  mail?: Mail,
  earlier?: EarlierSpend,
  fanOuts: RecordedFanOuts = NO_FAN_OUTS,
): Replay & { kept: () => string[] } => {
  const sessions = new Map(cutOff);
  const used = new Map<string, number>();
  const anew = new Set<string>();
  const fresh = new WeakSet<object>();
  /** Fanned nodes whose list was resolved anew: their items can't be replayed. */
  const renewed = new Set<string>();

  const takeItem = (activation: Activation, of: string): NodeResult | null => {
    const recorded = fanOuts.items
      .get(activation.id)
      ?.get(activation.round ?? 0);
    if (
      recorded !== undefined &&
      !renewed.has(of) &&
      !carries(fresh, activation.input)
    ) {
      return recorded;
    }
    anew.add(activation.id);
    return null;
  };

  return {
    take: activation => {
      const { id } = activation;
      if (activation.brief !== undefined || anew.has(id)) return null;
      if (activation.item !== undefined) {
        return takeItem(activation, activation.item.of);
      }
      const index = used.get(id) ?? 0;
      const recorded = history.get(id)?.[index];
      if (recorded === undefined || carries(fresh, activation.input)) {
        anew.add(id);
        return null;
      }
      used.set(id, index + 1);
      return recorded;
    },
    ran: result => {
      fresh.add(result.output);
    },
    cutOff: activation => {
      // A delegated run is its leader's: it never continues a cut session.
      const session =
        activation.brief === undefined &&
        (activation.item === undefined || !renewed.has(activation.item.of))
          ? sessions.get(activation.id)
          : undefined;
      sessions.delete(activation.id);
      return session;
    },
    listed: (id, round, source) => {
      const list = fanOuts.lists.get(listKey(id, round));
      const ranAnew =
        typeof source === "object" && source !== null && fresh.has(source);
      if (list !== undefined && !ranAnew) return list;
      renewed.add(id);
      return null;
    },
    previousSession: ({ id, item, round = 0 }) =>
      item === undefined || renewed.has(item.of)
        ? undefined
        : [...(fanOuts.items.get(id) ?? [])].findLast(
            ([before]) => before < round,
          )?.[1].sessionId,
    lastOutput: id => history.get(id)?.at(-1)?.output,
    kept: () => [...history.keys(), ...fanOuts.items.keys()],
    ...(mail === undefined ? {} : { mail }),
    ...(earlier === undefined ? {} : { earlier }),
  };
};

/**
 * The run's `HumanChannel`, answering questions about loops out of rounds as
 * they were answered last time, in order; anything else goes to `human`.
 */
export const replayLoopAnswers = (
  human: HumanChannel,
  answers: readonly { question: string; answer: string }[],
): HumanChannel => {
  const left = [...answers];
  return {
    permit: request => human.permit(request),
    ...(human.settled === undefined ? {} : { settled: human.settled }),
    ask: question => {
      const index = left.findIndex(a => a.question === question.question);
      const [given] = index === -1 ? [] : left.splice(index, 1);
      return given === undefined
        ? human.ask(question)
        : Promise.resolve(given.answer);
    },
  };
};
