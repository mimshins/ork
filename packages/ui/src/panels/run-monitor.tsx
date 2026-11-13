/**
 * @file One run in the Monitor: a stat strip, its graph, its nodes as a table
 *   with what each is doing, why a stopped run stopped, a finished run's
 *   declared outputs, and the selected node's strip, live from its stream.
 *   Pointing at a node in the graph or the table picks it out in both.
 */

import { useState } from "react";

import { MonitorError, RunCanvas } from "./monitor-parts.tsx";
import { NodeSection } from "./node-section.tsx";
import { OwnershipTree } from "./ownership-tree.tsx";
import { RunHeader } from "./run-header.tsx";
import { RunLinks } from "./run-links.tsx";
import { RunSummary } from "./run-summary.tsx";
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
        budgetTokens={graph?.budgetTokens}
        budgetUsd={graph?.budgetUsd}
        facts={facts}
        now={now}
        run={run}
        waiting={waiting}
      />
      {error === null ? null : <MonitorError error={error} />}
      <RunSummary
        onSelect={state.selectNode}
        roots={roots}
        run={run}
      />
      <RunCanvas
        facts={facts}
        holding={holding}
        hovered={hovered}
        label={`Graph of run ${run.id}, ${run.workflow}`}
        layout={layout}
        onHover={setHovered}
        onNodeMenu={openControls}
        onSelect={state.selectNode}
        runId={run.id}
        selected={selected ?? undefined}
      />
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
