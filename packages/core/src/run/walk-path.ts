/**
 * @file One way through a workflow in a walk (RFC-009): one `startRun` with
 *   stand-in executors and a scripted human, which replays the choices it's
 *   given and takes the first way from there. What it sees goes in the walk's
 *   tally.
 */

import { evaluate, truthy } from "../expr/evaluate.ts";
import type { CompiledGraph } from "../graph/types.ts";
import type { HumanChannel } from "../runtime/types.ts";
import { LOOP_CHOICES } from "./escalation.ts";
import { runScope } from "./scope.ts";
import type {
  NodeExecutor,
  NodeExecutors,
  NodeOutput,
  RunEvent,
} from "./types.ts";
import { linkOf } from "./walk-findings.ts";
import type { WalkPlan } from "./walk-plan.ts";

/**
 * Only a loop's first two rounds branch, and later ones repeat the second. What
 * routes a node is its own latest output, so a second round has nothing new to
 * show after each first one: it branches for the first history of first rounds
 * to reach it, and others repeat their first round. What this could hide makes
 * no claim (`walk-findings.ts`): a condition reading another node, and a join a
 * loop feeds.
 */
export const BRANCHING_ROUNDS = 2;

/** What stops a path before its run has started. */
const nothingYet = (): void => {
  // Nothing has started.
};

/** How many activations a path goes between looks at the clock. */
const CLOCK_EVERY = 64;

/** One choice on a path: which of its `count` ways it took. */
export type Decision = { key: string; index: number; count: number };

/** The choices of one path: the ones it was given, then the first way on. */
const createChoices = (given: readonly Decision[]) => {
  const planned = new Map(given.map(({ key, index }) => [key, index]));
  const taken = new Map<string, number>();
  const decisions: Decision[] = [];
  const said: string[] = [];
  return {
    decisions,
    said,
    /** Which way to go; `saying` names it, if it's worth listing as a choice. */
    choose: (
      key: string,
      count: number,
      saying: (index: number) => string | null,
    ): number => {
      const earlier = taken.get(key);
      if (earlier !== undefined) return Math.min(earlier, count - 1);
      const index = Math.min(planned.get(key) ?? 0, Math.max(count - 1, 0));
      taken.set(key, index);
      if (count > 1) {
        decisions.push({ key, index, count });
        const words = saying(index);
        if (words !== null) said.push(words);
      }
      return index;
    },
  };
};

const scriptedHuman = (
  choices: ReturnType<typeof createChoices>,
): HumanChannel => {
  const asked = new Map<string, number>();
  return {
    permit: () => Promise.resolve({ allow: true }),
    ask: ({ nodeId, question, options }) => {
      const times = asked.get(question) ?? 0;
      asked.set(question, times + 1);
      // Another round is tried once: rounds after that repeat, so it ends.
      const open =
        times === 0
          ? options
          : options.filter(({ id }) => id !== LOOP_CHOICES.again);
      const index = choices.choose(
        `ask:${question}:${String(times)}`,
        open.length,
        at => `${nodeId} ran out of rounds: ${open[at]?.id ?? ""}`,
      );
      return Promise.resolve(open[index]?.id ?? LOOP_CHOICES.stop);
    },
  };
};

const nodeKey = (id: string, round: number): string =>
  `node:${id}:${String(round)}`;

/** Which round's choice this activation follows. */
const branchingRound = (
  { secondRounds }: WalkPlan,
  { decisions }: ReturnType<typeof createChoices>,
  id: string,
  round: number,
): number => {
  if (round === 1) return 1;
  const history = decisions
    .filter(({ key }) => key.startsWith("node:") && key.endsWith(":1"))
    .map(({ key, index }) => `${key}=${String(index)}`)
    .join();
  const allowed = secondRounds.get(id) ?? history;
  secondRounds.set(id, allowed);
  return allowed === history ? BRANCHING_ROUNDS : 1;
};

const standIn =
  (
    plan: WalkPlan,
    choices: ReturnType<typeof createChoices>,
    outputs: Readonly<Record<string, NodeOutput>>,
  ): NodeExecutor =>
  ({ id, round, node }) => {
    const until = plan.untils.get(id) ?? null;
    const all = plan.outcomes.get(id) ?? [];
    // A watched node ends only ways a wait can: its condition holds, it runs
    // out of time on a look where it doesn't, or a look fails.
    const open =
      until === null
        ? all
        : all.filter(outcome => {
            const holds = truthy(
              evaluate(until, {
                ...runScope(plan.inputs, outputs),
                output: { ok: true, ...outcome.output },
              }),
            );
            return outcome.ok ? holds : outcome.timedOut !== true || !holds;
          });
    if (until !== null && !open.some(({ ok }) => ok)) {
      plan.tally.undecided.add(id);
    }
    const index = choices.choose(
      nodeKey(id, branchingRound(plan, choices, id, round)),
      open.length,
      at => {
        const name = round > 1 ? `${id}, round ${String(round)}` : id;
        const said = open[at]?.said ?? "";
        // Going on as hoped isn't a choice that led anywhere; a person's is.
        const hoped = round === 1 && at === 0 && node.type !== "human.gate";
        return hoped || said === "succeeded" ? null : `${name}: ${said}`;
      },
    );
    const outcome = open[index];
    return Promise.resolve(
      outcome === undefined
        ? { ok: false, output: {}, error: "a stand-in has no outcome" }
        : {
            ok: outcome.ok,
            output: outcome.output,
            ...(outcome.ok ? {} : { error: outcome.said }),
            ...(outcome.stopsRun === true
              ? { limited: outcome.said, stopsAs: "failed" as const }
              : {}),
          },
    );
  };

const executorsFor = (
  graph: CompiledGraph,
  executor: NodeExecutor,
): NodeExecutors =>
  Object.fromEntries(
    [...graph.nodes.values()].map(({ node }) => [node.type, executor]),
  );

/** What this path needs to start a run, and what it saw once it ended. */
export const createPath = (plan: WalkPlan, given: readonly Decision[]) => {
  const { graph, inputs, tally } = plan;
  const choices = createChoices(given);
  const outputs: Record<string, NodeOutput> = {};
  const started = new Set<string>();
  const taken = new Set<string>();
  const exhausted = new Set<string>();
  let activations = 0;
  let overran = false;
  let stop = nothingYet;

  /**
   * One path can multiply activations, and each finish can cost as much as the
   * graph, so the clock can't wait for its end.
   */
  const checkClock = (): void => {
    activations += 1;
    if (activations % CLOCK_EVERY === 0 && performance.now() > plan.deadline) {
      overran = true;
      stop();
    }
  };

  const noteConditions = (id: string, ok: boolean, output: NodeOutput) => {
    const scope = runScope(inputs, outputs);
    for (const edge of graph.nodes.get(id)?.outgoing ?? []) {
      const link = linkOf(edge);
      if (edge.condition !== undefined && plan.reading.has(link)) {
        const holds = truthy(
          evaluate(edge.condition, { ...scope, output: { ok, ...output } }),
        );
        const went = tally.went.get(link) ?? { held: false, unheld: false };
        tally.went.set(link, {
          held: went.held || holds,
          unheld: went.unheld || !holds,
        });
      }
    }
  };

  const onEvent = (event: RunEvent): void => {
    if (event.type === "node.started") {
      started.add(event.id);
      tally.ran.add(event.id);
      checkClock();
    } else if (event.type === "node.finished") {
      outputs[event.id] = event.output;
      noteConditions(event.id, event.ok, event.output);
      checkClock();
    } else if (event.type === "edge.taken") {
      taken.add(linkOf(event));
    } else if (event.type === "loop.exhausted") {
      exhausted.add(linkOf(event));
    }
  };

  return {
    options: {
      graph,
      inputs,
      runId: "walk",
      // Nothing reads it: a stand-in does no work anywhere.
      cwd: ".",
      executors: executorsFor(graph, standIn(plan, choices, outputs)),
      human: scriptedHuman(choices),
      onEvent,
    },
    decisions: choices.decisions,
    said: choices.said,
    started,
    /** How to stop this path's run if it runs out of time. */
    stopWith: (interrupt: () => void): void => {
      stop = interrupt;
    },
    /** Whether it ran out of time, so its ending says nothing. */
    overran: (): boolean => overran,
    /** Notes which loops this path went through, now that it's ended. */
    finish: (succeeded: boolean): void => {
      for (const link of taken) tally.entered.add(link);
      if (!succeeded) return;
      // It went through the loop's nodes and out, without this edge running out.
      for (const [link, group] of plan.loopGroups) {
        const through = [...group].some(id => started.has(id));
        if (through && !exhausted.has(link)) tally.left.add(link);
      }
    },
  };
};
