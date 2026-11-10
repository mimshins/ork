/**
 * @file A benchmark's working time: when at least one Claude or tool node ran,
 *   was not blocked on its own open decision, and was not a leader waiting on a
 *   running child. Gates and `workflow.call` nodes are waits, never work.
 */

import { rec, text } from "./json.ts";
import type { Decision, StoredEvent } from "./tree.ts";

/** A node's activation, from `node.started` to `node.finished`. */
export type Activation = {
  run: string;
  node: string;
  round: number;
  type: string;
  owner?: string;
  agent?: string;
  start: number;
  end: number;
  ok?: boolean;
};

/** Node types that wait on someone else, never work themselves. */
export const WAITS: ReadonlySet<string> = new Set([
  "human.gate",
  "workflow.call",
]);

const started = (e: StoredEvent, id: string, round: number): Activation => {
  const agent = text(rec(e.data["agent"])["name"]);
  const owner = text(e.data["owner"]);
  return {
    run: e.run,
    node: id,
    round,
    type: text(e.data["nodeType"]) ?? "",
    ...(owner === undefined ? {} : { owner }),
    ...(agent === undefined ? {} : { agent }),
    start: e.at,
    end: e.at,
  };
};

/** Every node activation; one still open ends at `last`. */
export const activations = (
  events: readonly StoredEvent[],
  last: number,
): Activation[] => {
  const open = new Map<string, Activation>();
  const done: Activation[] = [];
  for (const e of events) {
    const id = text(e.data["id"]) ?? e.node ?? "";
    const round = typeof e.data["round"] === "number" ? e.data["round"] : 1;
    const key = `${e.run}/${id}/${String(round)}`;
    if (e.type === "node.started") open.set(key, started(e, id, round));
    const begun = open.get(key);
    if (e.type === "node.finished" && begun !== undefined) {
      const ok = e.data["ok"];
      done.push(
        Object.assign(
          { ...begun, end: e.at },
          typeof ok === "boolean" ? { ok } : {},
        ),
      );
      open.delete(key);
    }
  }
  for (const a of open.values())
    done.push(Object.assign({ ...a }, { end: last }));
  return done;
};

/** Whether anything is working at the moment `at`. */
const workingAt = (
  acts: readonly Activation[],
  spans: readonly { run: string; node: string; start: number; end: number }[],
  at: number,
): boolean => {
  const running = acts.filter(
    x => x.start <= at && at < x.end && !WAITS.has(x.type),
  );
  const blocked = (n: Activation) =>
    spans.some(
      s => s.run === n.run && s.node === n.node && s.start <= at && at < s.end,
    );
  const waitsOnChild = (n: Activation) =>
    running.some(c => c.run === n.run && c.owner === n.node);
  return running.some(n => !blocked(n) && !waitsOnChild(n));
};

/** Milliseconds of working time; a decision still open lasts to `last`. */
export const workingMs = (
  acts: readonly Activation[],
  decisions: readonly Decision[],
  last: number,
): number => {
  const spans = decisions.map(d => ({
    run: d.run,
    node: d.node,
    start: d.openedAt,
    end: d.closedAt ?? last,
  }));
  const points = [
    ...new Set([
      ...acts.flatMap(a => [a.start, a.end]),
      ...spans.flatMap(s => [s.start, s.end]),
    ]),
  ].toSorted((a, b) => a - b);
  let total = 0;
  for (const [i, a] of points.entries()) {
    const b = points[i + 1];
    if (b !== undefined && workingAt(acts, spans, (a + b) / 2)) total += b - a;
  }
  return total;
};
