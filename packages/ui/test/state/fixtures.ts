/**
 * @file The state tests' setup: stored events and run records, and a real
 *   client on a fake server holding one run's events, which answers the way the
 *   real one does and records what it was asked.
 */

import {
  createClient,
  type RunView,
  type StoredEvent,
} from "@krapht/ork-server/client";

export const stored = (seq: number): StoredEvent => ({
  runId: "run",
  seq,
  at: "2026-11-02T00:00:00.000Z",
  event: { type: "node.started", id: "lead", nodeType: "tool.shell", round: 1 },
});

/** Stored events with the seqs from `first` to `last`. */
export const span = (first: number, last: number): StoredEvent[] =>
  Array.from({ length: last - first + 1 }, (_, index) => stored(first + index));

export const seqsOf = (events: readonly StoredEvent[]): number[] =>
  events.map(({ seq }) => seq);

export const runView = (
  id: string,
  live: RunView["live"] = "running",
): RunView => ({
  id,
  workflow: "w",
  file: "/w.ork.yaml",
  project: "/p",
  status: "running",
  pid: 1,
  startedAt: "2026-11-02T00:00:00.000Z",
  costUsd: 0,
  live,
  paused: { run: false, nodes: [] },
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const numberIn = (query: URLSearchParams, name: string): number | undefined => {
  const raw = query.get(name);
  return raw === null ? undefined : Number(raw);
};

const pageOf = (events: readonly StoredEvent[], query: URLSearchParams) => {
  const fresh = events.filter(
    ({ seq }) => seq > (numberIn(query, "after") ?? 0),
  );
  const last = numberIn(query, "last");
  const limit = numberIn(query, "limit");
  const newest = last === undefined ? fresh : fresh.slice(-last);
  return limit === undefined ? newest : newest.slice(0, limit);
};

type FakeServer = {
  events: StoredEvent[];
  /** The status every read answers with, while set. */
  failing: number | null;
  version: string;
  asked: string[];
};

/** A server with one run's events. */
export const fakeServer = (events: StoredEvent[] = []) => {
  const server: FakeServer = {
    events,
    failing: null,
    version: "0.3.0",
    asked: [],
  };
  const answer = (url: URL): Response => {
    if (server.failing !== null) {
      return json(
        { error: `Refused: ${String(server.failing)}.` },
        server.failing,
      );
    }
    return url.pathname === "/api/health"
      ? json({ version: server.version, pid: 1, startedAt: "now" })
      : json(pageOf(server.events, url.searchParams));
  };
  const client = createClient({
    fetch: input => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        "http://ork.test",
      );
      server.asked.push(`${url.pathname}${url.search}`);
      return Promise.resolve(answer(url));
    },
  });
  return { server, client };
};
