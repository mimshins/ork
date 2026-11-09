/**
 * @file One run in the Monitor: a stat strip, its graph, its nodes as a table
 *   with what each is doing, and the selected node's strip, live from its
 *   stream. Pointing at a node in the graph or the table picks it out in both.
 */

import { useState } from "react";

import { EmptyState } from "../components/bits.tsx";
import { GraphView } from "../graph/graph-view.tsx";
import { MonitorError, NodeSection } from "./node-section.tsx";
import { OwnershipTree } from "./ownership-tree.tsx";
import { RunHeader } from "./run-header.tsx";
import { RunLinks } from "./run-links.tsx";
import { useClock } from "./use-clock.ts";
import { type RunView, useRunMonitor } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const RunMonitor = ({ run }: { run: RunView }) => {
  const {
    state,
    graph,
    layout,
    facts,
    waiting,
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
  } = useRunMonitor(run);
  const [hovered, setHovered] = useState<string | null>(null);
  const now = useClock(run.live === "running" || run.live === "paused");
  return (
    <div className={styles["monitor"]}>
      <RunHeader
        budgetUsd={graph?.budgetUsd}
        facts={facts}
        now={now}
        run={run}
        waiting={waiting}
      />
      {error === null ? null : <MonitorError error={error} />}
      <div className={styles["canvas"]}>
        {layout === null ? (
          <EmptyState
            cli={`ork tree ${run.id}`}
            title="Reading the run…"
          >
            For now:
          </EmptyState>
        ) : (
          <GraphView
            facts={facts}
            holding={holding}
            hovered={hovered}
            label={`Graph of run ${run.id}, ${run.workflow}`}
            layout={layout}
            live
            onHover={setHovered}
            onNodeMenu={openControls}
            onSelect={state.selectNode}
            selected={selected ?? undefined}
          />
        )}
      </div>
      <OwnershipTree
        connections={connections}
        edges={graph?.edges ?? []}
        facts={facts}
        hovered={hovered}
        now={now}
        onHover={setHovered}
        onNodeMenu={openControls}
        onSelect={state.selectNode}
        roots={roots}
        runFinishedAt={run.finishedAt}
        selected={selected}
      />
      {chosen === undefined ? null : (
        <NodeSection
          node={chosen}
          progress={facts.get(chosen.id)?.progress}
          onLeave={closeControls}
          onOpenRun={state.arriveAt}
          run={run}
          sectionRef={nodeControls}
        />
      )}
      <RunLinks
        links={links}
        onOpen={state.arriveAt}
        runId={run.id}
      />
    </div>
  );
};
