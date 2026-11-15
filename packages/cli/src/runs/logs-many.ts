/**
 * @file `ork logs` over several runs: a run with the runs it called inline
 *   under their call paths, and every live run of a project interleaved behind
 *   a `<id> <workflow> › ` prefix (`logs -f --all`; specs/cli.md,
 *   specs/scheduler/calls.md).
 */

import {
  type EventStore,
  followRuns,
  followRunTree,
  type FollowRunsScope,
  liveStatus,
  type RunRecord,
  type StoredEvent,
} from "@krapht/ork-core";

import { style } from "../output.ts";
import { createView, styler, type View } from "../run/view.ts";
import type { Term } from "../term/mode.ts";
import { printerFor, printUnder } from "./gutter.ts";
import {
  createLogPrinter,
  type FilterOptions,
  matcher,
  unknownNode,
} from "./logs.ts";

export type ManyLogOptions = FilterOptions & {
  /** The stored events as JSON lines, without a prefix. */
  json: boolean;
  /** A failed node's hint and scrubbed detail. */
  verbose?: boolean;
  /** Print only the last this many stored events, overall (not per run). */
  limit?: number;
  /** How lines are drawn (default: stdout's), for tests. */
  view?: View;
  /** How often to poll a run that has no socket, and for new runs. */
  intervalMs?: number;
  /** `~`, for the runs' sockets; tests pass a folder. */
  home?: string;
  signal?: AbortSignal;
};

/**
 * The stored events of `roots` and of the runs they called, at any depth, in
 * the order they print: a called run's right after its `call.started`.
 */
const treeEvents = (
  store: EventStore,
  roots: readonly string[],
): StoredEvent[] => {
  const seen = new Set(roots);
  const walk = (id: string, into: StoredEvent[]): StoredEvent[] => {
    for (const stored of store.events(id)) {
      into.push(stored);
      const { event } = stored;
      if (event.type === "call.started" && !seen.has(event.run)) {
        seen.add(event.run);
        walk(event.run, into);
      }
    }
    return into;
  };
  return roots.flatMap(id => walk(id, []));
};

/** `run:seq` of an event, to name it in a set. */
const keyOf = (stored: StoredEvent): string => `${stored.runId}:${stored.seq}`;

/**
 * The stored events (in print order, over all of `roots`' runs) that `--limit`
 * cuts: all but the last `limit` that pass the filters. Events stored after
 * this read are not in it, so they always print.
 */
const droppedBy = (
  store: EventStore,
  roots: readonly string[],
  options: ManyLogOptions,
): Set<string> => {
  if (options.limit === undefined) return new Set();
  const matches = matcher(options);
  const kept = treeEvents(store, roots).filter(stored => matches(stored));
  return new Set(kept.slice(0, -options.limit).map(stored => keyOf(stored)));
};

type Printer = ReturnType<typeof createLogPrinter>;

/** A run's printer: JSON lines as stored, or text laid out behind `path`. */
const printerOf = (
  term: Term,
  options: ManyLogOptions,
  path: readonly string[],
): Printer =>
  options.json
    ? createLogPrinter({ json: true })
    : printerFor(term, path, {
        ...(options.verbose === undefined ? {} : { verbose: options.verbose }),
        ...(options.node === undefined ? {} : { node: options.node }),
      });

/** Prints a run's `lines` behind `path`'s gutter; JSON lines have none. */
const show = (
  out: (line: string) => void,
  term: Term,
  options: ManyLogOptions,
  path: readonly string[],
  lines: readonly string[],
): void => {
  if (options.json) {
    for (const line of lines) out(line);
  } else {
    printUnder(out, term, path, lines);
  }
};

/** What the clock-free options of a follower are, as `followRuns` takes them. */
const pollOf = (options: ManyLogOptions) => ({
  ...(options.home === undefined ? {} : { home: options.home }),
  ...(options.intervalMs === undefined
    ? {}
    : { intervalMs: options.intervalMs }),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
});

/**
 * Whether `--node` names nothing in `root` or the runs it called (none of them
 * has such an event or declares it), as `unknownNode` says for one run.
 */
export const unknownCallNode = (
  store: EventStore,
  root: string,
  node: string,
  live: boolean,
): string | null => unknownNode(treeEvents(store, [root]), node, live);

/**
 * Prints `root`'s events and those of the runs it called, each called run's
 * right after the `call.started` that started it, under its call path. With
 * `follow`, goes on until the root ends (or `signal` aborts), then names the
 * called runs still running.
 */
export const printCalls = async (
  store: EventStore,
  root: RunRecord,
  out: (line: string) => void,
  options: ManyLogOptions & { follow: boolean },
): Promise<void> => {
  const { term } = options.view ?? createView();
  const say = styler(term);
  const matches = matcher(options);
  const dropped = droppedBy(store, [root.id], options);
  const printers = new Map<string, Printer>();
  const { end, stillRunning } = await followRunTree(
    store,
    root.id,
    ({ run, path, stored }) => {
      let print = printers.get(run);
      if (print === undefined) {
        print = printerOf(term, options, path);
        printers.set(run, print);
      }
      // Every event goes through the printer, which keeps the state later
      // lines need; only the ones that pass the filters print.
      const lines = print(stored);
      if (matches(stored) && !dropped.has(keyOf(stored))) {
        show(out, term, options, path, lines);
      }
    },
    { follow: options.follow, ...pollOf(options) },
  );
  if (end === "crashed") {
    out(
      style(
        "red",
        `run ${root.id} stopped without finishing (its process is gone)`,
      ),
    );
  }
  if (!options.follow || options.json) return;
  for (const id of stillRunning) {
    out(say("dim", `↳ run ${id} still running · ork attach ${id}`));
  }
};

/**
 * Prints the events of every live run in `scope` (a called run too, once), each
 * line behind `<4-char id> <workflow> › `: the stored events first, then new
 * ones, runs that start later included. Ends when `signal` aborts, or with
 * `untilIdle` once no run is live.
 */
export const printAll = async (
  store: EventStore,
  scope: FollowRunsScope,
  out: (line: string) => void,
  options: ManyLogOptions & { untilIdle?: boolean },
): Promise<void> => {
  const { term } = options.view ?? createView();
  const matches = matcher(options);
  const { project } = scope;
  const listed = store.runs(
    project === undefined || project === "all" ? {} : { project },
  );
  // With --workflow: its runs, and the runs they call, as followRuns takes.
  const kept = new Set(
    listed
      .filter(
        r => scope.workflow === undefined || r.workflow === scope.workflow,
      )
      .map(r => r.id),
  );
  for (const run of listed.toReversed()) {
    if (run.parent !== undefined && kept.has(run.parent)) kept.add(run.id);
  }
  const live = listed.filter(
    run => kept.has(run.id) && liveStatus(run) === "running",
  );
  const dropped = droppedBy(
    store,
    live.map(run => run.id),
    options,
  );
  const printers = new Map<string, Printer>();
  await followRuns(
    store,
    scope,
    ({ run, workflow, stored }) => {
      const path = [`${run.slice(0, 4)} ${workflow}`];
      let print = printers.get(run);
      if (print === undefined) {
        print = printerOf(term, options, path);
        printers.set(run, print);
      }
      const lines = print(stored);
      if (matches(stored) && !dropped.has(keyOf(stored))) {
        show(out, term, options, path, lines);
      }
    },
    {
      ...(options.untilIdle === true ? { untilIdle: true } : {}),
      ...pollOf(options),
    },
  );
};
