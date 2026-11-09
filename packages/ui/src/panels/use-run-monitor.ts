/**
 * @file What the Monitor reads of a run while it is open: its feed and watch
 *   held for as long as it shows, the layout, which changes only when the run's
 *   nodes do so a busy run does not move the drawing, and each node's card.
 */

import type { RunView } from "@krapht/ork-server/client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useValue } from "react-containerized-state";

import { connectionsOf } from "../graph/connections.ts";
import { layoutGraph } from "../graph/layout.ts";
import { useAppState } from "../state/context.tsx";
import {
  askingNodes,
  factsOf,
  graphInputOf,
  itemIndex,
  rowsOf,
} from "./monitor-model.ts";
import { useRunAnnouncer } from "./use-run-announcer.ts";

export type { RunView };

export const useRunMonitor = (run: RunView) => {
  const state = useAppState();
  const runId = run.id;
  const watch = useMemo(() => state.watchRun(runId), [state, runId]);
  useEffect(() => {
    const release = state.retainRun(runId);
    const stop = watch.start();
    return () => {
      stop();
      release();
    };
  }, [state, watch, runId]);
  const { graph, tree, links, error } = useValue(watch.state);
  const decisions = useValue(state.decisions);
  const { node: selected } = useValue(state.selection);
  const nodeControls = useRef<HTMLElement>(null);
  /** Where the menu keys were pressed, for Escape to go back to. */
  const cameFrom = useRef<HTMLElement | null>(null);

  const roots = useMemo(() => tree ?? [], [tree]);
  const runEnded = run.live !== "running" && run.live !== "paused";
  const asking = useMemo(
    () => askingNodes(decisions, runId),
    [decisions, runId],
  );
  const facts = useMemo(
    () => factsOf(roots, asking, runId, runEnded),
    [roots, asking, runId, runEnded],
  );
  const nodeKey = rowsOf(roots)
    .map(({ node }) => node.id)
    .join("\n");
  const layout = useMemo(
    () => (graph === null ? null : layoutGraph(graphInputOf(graph, roots))),
    // oxlint-disable-next-line react/exhaustive-deps -- the tree's other changes do not move the drawing
    [graph, nodeKey],
  );
  const connections = useMemo(
    () => connectionsOf(layout?.edges ?? []),
    [layout],
  );
  const chosen = rowsOf(roots).find(({ node }) => node.id === selected)?.node;
  /** The node whose item is the selection: its card is marked. */
  const holding =
    chosen !== undefined && itemIndex(chosen) !== undefined
      ? chosen.template
      : undefined;
  useRunAnnouncer(run, facts);

  /** The menu keys: selects the node and goes to its controls. */
  const openControls = useCallback(
    (id: string): void => {
      const { activeElement } = document;
      cameFrom.current =
        activeElement instanceof HTMLElement ? activeElement : null;
      state.selectNode(id);
      requestAnimationFrame(() => {
        nodeControls.current?.querySelector("button")?.focus();
      });
    },
    [state],
  );

  /** Escape in the node's controls: back to the node they were asked from. */
  const closeControls = useCallback((): void => {
    cameFrom.current?.focus({ preventScroll: true });
    cameFrom.current = null;
  }, []);

  return {
    state,
    graph,
    layout,
    facts,
    waiting: asking.size > 0,
    connections,
    roots,
    links,
    error,
    selected,
    holding,
    chosen,
    nodeControls,
    openControls,
    closeControls,
  };
};
