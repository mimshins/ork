/**
 * @file Two pieces of the Monitor that are not tables or strips: the graph's
 *   canvas, or the words that stand in for it while the run is read, and what
 *   went wrong reading the run.
 */

import type { ComponentProps } from "react";

import { EmptyState } from "../components/bits.tsx";
import { CodeText } from "../components/code-text.tsx";
import { GraphView } from "../graph/graph-view.tsx";

import styles from "./monitor.module.css";

/** What went wrong reading the run. */
export const MonitorError = ({ error }: { error: string }) => (
  <p
    className={styles["error"]}
    role="alert"
  >
    <CodeText text={error} />
  </p>
);

/** The run's graph, live; `layout` is `null` until the run has been read. */
export const RunCanvas = ({
  runId,
  layout,
  ...graph
}: { runId: string } & Omit<
  ComponentProps<typeof GraphView>,
  "layout" | "live"
> & { layout: ComponentProps<typeof GraphView>["layout"] | null }) => (
  <div className={styles["canvas"]}>
    {layout === null ? (
      <EmptyState
        cli={`ork tree ${runId}`}
        title="Reading the run…"
      >
        For now:
      </EmptyState>
    ) : (
      <GraphView
        {...graph}
        layout={layout}
        live
      />
    )}
  </div>
);
