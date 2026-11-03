/**
 * @file The selected node's part of the Monitor: its controls, and for a call,
 *   the way to the run it started.
 */

import type { TreeNode } from "@krapht/ork-server/client";
import type { Ref } from "react";

import { Button } from "../components/button.tsx";
import { nodeActions } from "./monitor-model.ts";
import { RunControls } from "./run-controls.tsx";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./monitor.module.css";

export const NodeSection = ({
  run,
  node,
  sectionRef,
  onLeave,
  onOpenRun,
}: {
  run: RunView;
  node: TreeNode;
  sectionRef: Ref<HTMLElement>;
  /** Escape: go back to where the controls were asked for. */
  onLeave: () => void;
  onOpenRun: (run: string) => void;
}) => {
  const { calledRun } = node;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from the buttons inside
    <section
      aria-label={`Node ${node.id}`}
      className={styles["node"]}
      onKeyDown={event => {
        // The Stop dialog is portalled, and its keys come through React.
        const inside =
          event.target instanceof Node &&
          event.currentTarget.contains(event.target);
        if (event.key === "Escape" && inside) onLeave();
      }}
      ref={sectionRef}
    >
      <h3 className={styles["sideTitle"]}>{node.id}</h3>
      <RunControls
        actions={nodeActions(run, node)}
        node={node.id}
        runId={run.id}
      />
      {calledRun === undefined ? null : (
        <Button
          onClick={() => {
            onOpenRun(calledRun);
          }}
          variant="ghost"
        >
          Open run {calledRun}
        </Button>
      )}
    </section>
  );
};
