/**
 * @file One run in the Monitor: its header, its graph beside its ownership
 *   tree, live from its stream, with the controls for the run and the selected
 *   node.
 */

import { EmptyState } from "../components/bits.tsx";
import { GraphView } from "../graph/graph-view.tsx";
import { NodeSection } from "./node-section.tsx";
import { OwnershipTree } from "./ownership-tree.tsx";
import { RunHeader } from "./run-header.tsx";
import { RunLinks } from "./run-links.tsx";
import { type RunView, useRunMonitor } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const RunMonitor = ({ run }: { run: RunView }) => {
  const {
    state,
    layout,
    facts,
    waiting,
    connections,
    roots,
    links,
    error,
    selected,
    chosen,
    nodeControls,
    openControls,
    closeControls,
  } = useRunMonitor(run);
  return (
    <div className={styles["monitor"]}>
      <RunHeader
        run={run}
        waiting={waiting}
      />
      {error === null ? null : (
        <p
          className={styles["error"]}
          role="alert"
        >
          {error}
        </p>
      )}
      <div className={styles["body"]}>
        <div className={styles["canvas"]}>
          {layout === null ? (
            <EmptyState title="Reading the run…">
              For now: <code>ork tree {run.id}</code>
            </EmptyState>
          ) : (
            <GraphView
              facts={facts}
              label={`Graph of run ${run.id}, ${run.workflow}`}
              layout={layout}
              onNodeMenu={openControls}
              onSelect={state.selectNode}
              selected={selected ?? undefined}
            />
          )}
        </div>
        <aside
          aria-label="Ownership and links"
          className={styles["side"]}
        >
          {chosen === undefined ? null : (
            <NodeSection
              node={chosen}
              onLeave={closeControls}
              onOpenRun={state.arriveAt}
              run={run}
              sectionRef={nodeControls}
            />
          )}
          <OwnershipTree
            connections={connections}
            facts={facts}
            onNodeMenu={openControls}
            onSelect={state.selectNode}
            roots={roots}
            selected={selected}
          />
          <RunLinks
            links={links}
            onOpen={state.arriveAt}
            runId={run.id}
          />
        </aside>
      </div>
    </div>
  );
};
