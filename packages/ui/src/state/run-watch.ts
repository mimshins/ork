/**
 * @file What the Monitor shows of one run, in a container: its graph, its tree
 *   and its links. The server folds a run's whole history into its tree, so
 *   this reads it again when the run's stream has news, at most so often, and
 *   the store stays the truth. When reads overlap the newest wins.
 */

import type {
  Client,
  LinkRecord,
  TreeNode,
  WorkflowGraph,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import type { RunFeed } from "./run-feed.ts";

export type RunWatchState = {
  graph: WorkflowGraph | null;
  tree: readonly TreeNode[] | null;
  links: readonly LinkRecord[];
  /** Why the last read failed. */
  error: string | null;
};

export type RunWatch = {
  state: Container<RunWatchState>;
  /** Reads until the returned function is called. */
  start: () => () => void;
};

/** The most often the tree is read while a run is busy. */
export const REFRESH_MS = 250;

export const createRunWatch = ({
  runId,
  client,
  feed,
}: {
  runId: string;
  client: Client;
  feed: RunFeed;
}): RunWatch => {
  const state = Container.create<RunWatchState>({
    graph: null,
    tree: null,
    links: [],
    error: null,
  });
  const change = (next: Partial<RunWatchState>): void => {
    void state.setValue({ ...state.getValue(), ...next });
  };
  let newest = 0;

  const refresh = async (): Promise<void> => {
    newest += 1;
    const mine = newest;
    const [tree, links] = await Promise.all([
      client.call("tree", { params: { id: runId } }),
      client.call("links", { query: { run: runId } }),
    ]);
    if (mine !== newest) return;
    if (tree.ok) {
      change({
        tree: tree.data,
        links: links.ok ? links.data : state.getValue().links,
        error: null,
      });
    } else {
      change({ error: tree.error });
    }
  };

  const loadGraph = async (): Promise<void> => {
    const graph = await client.call("graph", { params: { id: runId } });
    if (graph.ok) change({ graph: graph.data });
    else change({ error: graph.error });
  };

  return {
    state,
    start: () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let latest = feed.state.getValue().latest;
      void loadGraph();
      void refresh();
      const stopListening = feed.state.subscribe(({ latest: now }) => {
        if (now === latest) return;
        latest = now;
        timer ??= setTimeout(() => {
          timer = null;
          void refresh();
        }, REFRESH_MS);
      });
      return () => {
        stopListening();
        if (timer !== null) clearTimeout(timer);
        // An answer on its way has nothing to tell anyone now.
        newest += 1;
      };
    },
  };
};
