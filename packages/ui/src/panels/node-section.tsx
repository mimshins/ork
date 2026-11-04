/**
 * @file The selected node's strip in the Monitor: what it is and what it has
 *   used, what its `watch:` is waiting for, its controls, and for a call, the
 *   way to the run it started.
 */

import type { TreeNode } from "@krapht/ork-server/client";
import { type Ref, useEffect, useState } from "react";

import { Button } from "../components/button.tsx";
import { formatTokens, typeWord } from "../graph/facts.ts";
import { nodeActions } from "./monitor-model.ts";
import { RunControls } from "./run-controls.tsx";
import type { RunView } from "./use-run-monitor.ts";
import { stillGoing, watchFacts } from "./watch-facts.ts";

import styles from "./monitor.module.css";

const TICK_MS = 5000;

/** What its `watch:` is waiting for, while it's waiting. */
const WatchingFacts = ({
  watching,
}: {
  watching: NonNullable<TreeNode["watching"]>;
}) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const facts = watchFacts(watching, now);
  return (
    <dl className={styles["watching"]}>
      <div>
        <dt>Waiting until</dt>
        <dd>
          <code>{facts.until}</code>
        </dd>
      </div>
      <div>
        <dt>Looks</dt>
        <dd>
          {facts.looks}, {facts.every}
        </dd>
      </div>
      <div>
        <dt>Next look</dt>
        <dd>{facts.next}</dd>
      </div>
      {facts.said === undefined ? null : (
        <div>
          <dt>Last said</dt>
          <dd>
            <code>{facts.said}</code>
          </dd>
        </div>
      )}
    </dl>
  );
};

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
        // Escape is the Stop dialog's while one is open, its focus there or not.
        const modalOpen = document.querySelector("[data-modal]") !== null;
        if (event.key === "Escape" && !modalOpen) onLeave();
      }}
      ref={sectionRef}
    >
      <h3 className={styles["sideTitle"]}>{node.id}</h3>
      <dl className={styles["nodeFacts"]}>
        <div>
          <dt>Type</dt>
          <dd>{typeWord(node.type)}</dd>
        </div>
        {node.model === undefined ? null : (
          <div>
            <dt>Model</dt>
            <dd>{node.model}</dd>
          </div>
        )}
        {node.inputTokens + node.outputTokens === 0 ? null : (
          <div>
            <dt>Tokens</dt>
            <dd>
              {formatTokens(node.inputTokens)} in ·{" "}
              {formatTokens(node.outputTokens)} out
            </dd>
          </div>
        )}
      </dl>
      <RunControls
        actions={nodeActions(run, node)}
        node={node.id}
        runId={run.id}
      />
      {node.watching === undefined || !stillGoing(run.status) ? null : (
        <WatchingFacts watching={node.watching} />
      )}
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
