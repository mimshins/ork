/**
 * @file The judge of what a walk claims (RFC-009): small random workflows, and an
 *   exploration of each on the real scheduler that a walk's shortcuts don't apply
 *   to. Every activation can end any way, `maxRounds` stays as written, and
 *   parallel nodes finish in several orders. Whatever it reaches, a walk can't
 *   say is unreachable. It uses the walk's own outcomes, so it can't see a
 *   stand-in that differs from a real node: `walk.test.ts` holds those.
 */

import type { HumanChannel } from "../../src/index.ts";
import { outcomesOf } from "../../src/run/walk-outcomes.ts";
import {
  type CompiledGraph,
  type NodeExecutor,
  type NodeExecutors,
  type RunEvent,
  startRun,
  type WalkResult,
} from "../../src/index.ts";

export type Random = (below: number) => number;

/** A small generator with a seed, so a failure can be run again. */
export const randomFrom = (start: number): Random => {
  let seed = start;
  return below => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return Math.floor((seed / 4_294_967_296) * below);
  };
};

const pickFrom = <T>(random: Random, items: readonly T[], fallback: T): T =>
  items[random(items.length)] ?? fallback;

const KINDS = [
  "claude",
  "claude",
  "claude",
  "tool",
  "gate",
  "router",
  "router",
  "split",
  "join",
  "join",
  "declaring",
] as const;

type Kind = (typeof KINDS)[number];

const nodeOf = (kind: Kind, random: Random): string => {
  const shapes: Record<Kind, readonly string[]> = {
    claude: ["{ type: claude.worker, prompt: x }"],
    declaring: [
      "{ type: claude.worker, prompt: x, output: { schema: { status: [pass, fail], verdict: [a, b] } } }",
    ],
    tool: ['{ type: tool.shell, command: "true", allow: ["true"] }'],
    gate: ["{ type: human.gate, question: q, options: [a, b] }"],
    router: ["{ type: control.router }", "{ type: control.router, mode: all }"],
    split: ["{ type: control.split }"],
    join: [
      "{ type: control.join }",
      "{ type: control.join, mode: any }",
      "{ type: control.join, mode: n, n: 2 }",
    ],
  };
  return pickFrom(random, shapes[kind], "");
};

const CONDITIONS: Record<Kind, readonly (string | null)[]> = {
  claude: [
    null,
    null,
    "status == 'pass'",
    "status == 'done'",
    "status == 'changes_requested'",
    "status != 'fail'",
    "status == 'fail'",
    "ok",
    "!ok",
  ],
  declaring: [
    null,
    "status == 'pass'",
    "status == 'fail'",
    "verdict == 'a'",
    "verdict == 'b'",
    "!ok",
  ],
  tool: [
    null,
    "exitCode == 0",
    "exitCode != 0",
    "exitCode == 2",
    "contains(stdout, 'x')",
    "!ok",
  ],
  gate: [null, "choice == 'a'", "choice == 'b'", "choice != 'a'"],
  router: [
    null,
    "true",
    "status == 'pass'",
    "status == 'done'",
    "choice == 'a'",
    "exitCode == 0",
  ],
  split: [null, "true", "status == 'pass'", "choice == 'a'"],
  join: [
    null,
    "any(statuses, 'pass')",
    "all(statuses, 'pass')",
    "any(statuses, 'done')",
    "count == 2",
    "count == 1",
  ],
};

const LOOP_CONDITIONS: Record<Kind, readonly string[]> = {
  claude: [
    "status == 'changes_requested'",
    "status != 'pass'",
    "status != 'fail'",
    "ok",
  ],
  declaring: ["status == 'pass'", "verdict == 'a'", "ok"],
  tool: ["exitCode == 0", "exitCode != 0", "contains(stdout, 'x')", "ok"],
  gate: ["choice == 'a'", "choice != 'a'"],
  router: ["status == 'pass'", "status != 'done'", "choice == 'a'"],
  split: ["status == 'pass'", "choice == 'a'"],
  join: ["any(statuses, 'pass')", "count == 1"],
};

const edgeOf = (from: number, to: number, condition: string | null): string =>
  condition === null
    ? `  - n${String(from)} -> n${String(to)}`
    : `  - { from: n${String(from)}, to: n${String(to)}, when: "${condition}" }`;

/** A workflow of 3 to 6 nodes; many won't compile, and the caller skips those. */
export const randomWorkflow = (random: Random): string => {
  const count = 3 + random(4);
  const kinds = Array.from({ length: count }, (_, at): Kind =>
    at === 0
      ? pickFrom<Kind>(random, ["claude", "tool", "gate", "split"], "claude")
      : pickFrom<Kind>(random, KINDS, "claude"),
  );
  const kindAt = (at: number): Kind => kinds[at] ?? "claude";
  const edges: string[] = [];
  for (let to = 1; to < count; to += 1) {
    const inputs = 1 + random(kindAt(to) === "join" ? 3 : 2);
    const froms = new Set(
      Array.from({ length: inputs }, () => random(to)),
    );
    for (const from of froms) {
      edges.push(
        edgeOf(from, to, pickFrom(random, CONDITIONS[kindAt(from)], null)),
      );
    }
  }
  const loops = new Set<string>();
  for (let tries = random(3); tries > 0; tries -= 1) {
    const from = 1 + random(count - 1);
    const to = random(from + 1);
    const key = `${String(from)}-${String(to)}`;
    if (!loops.has(key)) {
      loops.add(key);
      const when = pickFrom(random, LOOP_CONDITIONS[kindAt(from)], "ok");
      edges.push(
        `  - { from: n${String(from)}, to: n${String(to)}, maxRounds: ${String(1 + random(3))}, when: "${when}" }`,
      );
    }
  }
  return [
    "schemaVersion: 1",
    "name: t",
    "limits: { budgetUsd: 5 }",
    "nodes:",
    ...kinds.map((kind, at) => `  n${String(at)}: ${nodeOf(kind, random)}`),
    "edges:",
    ...edges,
  ].join("\n");
};

type Choice = { key: string; index: number; count: number };

const nextChoices = (made: readonly Choice[]): Choice[] | null => {
  for (let at = made.length - 1; at >= 0; at -= 1) {
    const choice = made[at];
    if (choice !== undefined && choice.index + 1 < choice.count) {
      return [...made.slice(0, at), { ...choice, index: choice.index + 1 }];
    }
  }
  return null;
};

const linkOf = (event: { from: string; to: string }): string =>
  `${event.from} -> ${event.to}`;

/** What the real scheduler can reach. */
export type Reached = {
  ran: Set<string>;
  /** Loop edges taken on a path that succeeded with them not running out. */
  left: Set<string>;
};

/** One way through: every activation its own choice, on the real scheduler. */
const onePath = async (
  graph: CompiledGraph,
  given: readonly Choice[],
  order: number,
  reached: Reached,
): Promise<Choice[]> => {
  const { outcomes } = outcomesOf(graph);
  const planned = new Map(given.map(({ key, index }) => [key, index]));
  const made: Choice[] = [];
  const choose = (key: string, count: number): number => {
    const index = Math.min(planned.get(key) ?? 0, Math.max(count - 1, 0));
    if (count > 1) made.push({ key, index, count });
    return index;
  };
  const executor: NodeExecutor = async ({ id, round }) => {
    // Enough turns of the event loop to change what finishes first.
    const turns = order * ((id.codePointAt(1) ?? 0) * 7 + round * 3) % 20;
    for (let turn = 0; turn < turns; turn += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- it only passes turns
      await Promise.resolve();
    }
    const all = outcomes.get(id) ?? [];
    const outcome = all[choose(`node:${id}:${String(round)}`, all.length)];
    return outcome === undefined
      ? { ok: false, output: {}, error: "no outcome" }
      : { ok: outcome.ok, output: outcome.output };
  };
  const asked = new Map<string, number>();
  const human: HumanChannel = {
    permit: () => Promise.resolve({ allow: true }),
    ask: ({ question, options }) => {
      const times = asked.get(question) ?? 0;
      asked.set(question, times + 1);
      const open =
        times === 0 ? options : options.filter(({ id }) => id !== "again");
      const index = choose(`ask:${question}:${String(times)}`, open.length);
      return Promise.resolve(open[index]?.id ?? "stop");
    },
  };
  const taken = new Set<string>();
  const exhausted = new Set<string>();
  const onEvent = (event: RunEvent): void => {
    if (event.type === "node.started") reached.ran.add(event.id);
    if (event.type === "edge.taken") taken.add(linkOf(event));
    if (event.type === "loop.exhausted") exhausted.add(linkOf(event));
  };
  const executors: NodeExecutors = Object.fromEntries(
    [...graph.nodes.values()].map(({ node }) => [node.type, executor]),
  );
  const { status } = await startRun({
    graph,
    inputs: {},
    runId: "fuzz",
    cwd: ".",
    executors,
    human,
    onEvent,
  }).done;
  if (status === "succeeded") {
    for (const link of taken) {
      if (!exhausted.has(link)) reached.left.add(link);
    }
  }
  return made;
};

/** All one finish order reaches, up to a number of paths. */
export const explore = async (
  graph: CompiledGraph,
  order: number,
  most: number,
): Promise<Reached> => {
  const reached: Reached = { ran: new Set(), left: new Set() };
  let given: Choice[] | null = [];
  for (let paths = 0; paths < most && given !== null; paths += 1) {
    // One path at a time: each replays what the last one chose.
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above
    given = nextChoices(await onePath(graph, given, order, reached));
  }
  return reached;
};

const namedIn = (message: string): string => /`([^`]+)`/u.exec(message)?.[1] ?? "";

/** What a walk said can't happen, and this exploration saw happen. */
export const falseClaims = (
  { findings }: WalkResult,
  { ran, left }: Reached,
): string[] =>
  findings.flatMap(({ code, message }) => {
    const named = namedIn(message);
    const wrong =
      (code === "walk.never-runs" && ran.has(named)) ||
      (code === "walk.only-rounds" && left.has(named));
    return wrong ? [`${code} ${named}`] : [];
  });
