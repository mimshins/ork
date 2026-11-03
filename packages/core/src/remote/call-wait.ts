/**
 * @file Waiting on a called run (RFC-004), following its events over its
 *   socket, falling back to the store: for the run to end, with its outputs, or
 *   for a named node to report. What the run spent meanwhile comes back as the
 *   node's usage, so it counts against the caller.
 */

import { failure } from "../run/results.ts";
import type { NodeResult, RunEvent, RunResult } from "../run/types.ts";
import type { SessionUsage } from "../runtime/types.ts";
import type { EventStore } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { followEvents } from "./follow.ts";

export type CallWatch = {
  store: EventStore;
  home?: string | undefined;
  /** What the called run has spent since it was last asked. */
  newCost: (id: string) => number;
};

export const usageOf = (costUsd: number): SessionUsage => ({
  costUsd,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 0,
  durationMs: 0,
});

export const lastSeq = (store: EventStore, id: string): number =>
  store.events(id).at(-1)?.seq ?? 0;

/**
 * Where the run's latest go starts in its events. A run that was resumed has an
 * end for each go, and only the last one says how it ended.
 */
export const lastGo = (store: EventStore, id: string): number => {
  const start = store
    .events(id)
    .findLast(
      ({ event }) =>
        event.type === "run.started" || event.type === "run.resumed",
    );
  return start === undefined ? 0 : start.seq - 1;
};

export const noWait = (id: string): NodeResult => ({
  ok: true,
  output: { status: "pass", summary: `Run ${id} started.`, run: id },
});

/** A node's report as a call's result; a failing one says why. */
const reportResult = (
  id: string,
  node: string,
  output: Record<string, unknown>,
  ok: boolean,
  usage: SessionUsage,
): NodeResult => {
  const summary = output["summary"];
  return {
    ok,
    output: { ...output, run: id },
    usage,
    ...(ok
      ? {}
      : {
          error:
            typeof summary === "string" ? summary : `${node} reported failure.`,
        }),
  };
};

/**
 * What the node last reported, for a caller coming back to the run: a resumed
 * run hands its kept results back with no new events, so none would come.
 */
export const storedReport = (
  watch: CallWatch,
  id: string,
  node: string,
): NodeResult | undefined => {
  const found = watch.store
    .events(id)
    .flatMap(({ event }) =>
      event.type === "node.finished" && event.id === node && event.ok
        ? [event.output]
        : [],
    )
    .at(-1);
  return found === undefined
    ? undefined
    : reportResult(id, node, found, true, usageOf(watch.newCost(id)));
};

const resultOf = (id: string, result: RunResult, cost: number): NodeResult => {
  const ok = result.status === "succeeded";
  const summary = ok
    ? `Run ${id} succeeded.`
    : `Run ${id} ended ${result.status}: ${result.reasons.join("; ")}`;
  return {
    ok,
    output: {
      status: ok ? "pass" : "fail",
      summary,
      run: id,
      runStatus: result.status,
      outputs: result.outputs ?? {},
    },
    usage: usageOf(cost),
    ...(ok ? {} : { error: summary }),
  };
};

/** The first thing `pick` finds in the run's events after `after`, if any. */
export const followRun = async <T>(
  { store, home }: CallWatch,
  id: string,
  after: number,
  signal: AbortSignal,
  pick: (event: RunEvent, seq: number) => T | undefined,
): Promise<T | undefined> => {
  const found = new AbortController();
  let picked: T | undefined;
  await followEvents(
    store,
    id,
    ({ event, seq }) => {
      picked ??= pick(event, seq);
      if (picked !== undefined) found.abort();
    },
    {
      follow: true,
      after,
      signal: AbortSignal.any([signal, found.signal]),
      ...(home === undefined ? {} : { home }),
    },
  );
  return picked;
};

export const finishedRun = (event: RunEvent): RunResult | undefined =>
  event.type === "run.finished" ? event.result : undefined;

export const waitForRun = async (
  watch: CallWatch,
  id: string,
  after: number,
  signal: AbortSignal,
): Promise<NodeResult> => {
  const result = await followRun(watch, id, after, signal, finishedRun);
  const cost = watch.newCost(id);
  if (result !== undefined) return resultOf(id, result, cost);
  const [run] = watch.store.lookup(id);
  const status = run === undefined ? "gone" : liveStatus(run);
  return {
    ...failure(`Run ${id} ended without a result (${status}).`),
    usage: usageOf(cost),
  };
};

/** The node's next report, or the run's end, whichever comes first. */
export const waitForNode = async (
  watch: CallWatch,
  id: string,
  node: string,
  after: number,
  signal: AbortSignal,
): Promise<NodeResult> => {
  const seen = await followRun<
    { ok: boolean; output: Record<string, unknown> } | { ended: RunResult }
  >(watch, id, after, signal, event => {
    if (event.type === "node.finished" && event.id === node) {
      return { ok: event.ok, output: event.output };
    }
    return event.type === "run.finished" ? { ended: event.result } : undefined;
  });
  const usage = usageOf(watch.newCost(id));
  if (seen === undefined) {
    return {
      ...failure(`Run ${id} ended before ${node} reported.`),
      usage,
    };
  }
  if ("ended" in seen) {
    return {
      ...failure(
        `${node} of run ${id} did not report: the run ended ${seen.ended.status}.`,
      ),
      usage,
    };
  }
  return reportResult(id, node, seen.output, seen.ok, usage);
};
