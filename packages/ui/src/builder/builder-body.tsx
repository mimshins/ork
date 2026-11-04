/**
 * @file The builder's body once a workflow is open: the palette, the canvas
 *   with the problems under it, and the inspector. The canvas lays itself out
 *   from the nodes and edges, as the Monitor does, so nothing here is dragged.
 */

import { useMemo } from "react";

import { EmptyState } from "../components/bits.tsx";
import { GraphView } from "../graph/graph-view.tsx";
import { layoutGraph } from "../graph/layout.ts";
import { factsOf } from "./builder-model.ts";
import { Palette, Problems } from "./canvas-parts.tsx";
import { connectEdit } from "./condition-model.ts";
import { Inspector } from "./node-inspector.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

const Canvas = ({ builder }: { builder: Builder }) => {
  const graph = builder.view?.graph;
  const problems = builder.view?.diagnostics;
  const layout = useMemo(
    () => (graph === undefined ? null : layoutGraph(graph)),
    [graph],
  );
  const facts = useMemo(
    () =>
      graph === undefined || problems === undefined
        ? undefined
        : factsOf(graph, problems),
    [graph, problems],
  );
  if (graph === undefined || layout === null) return null;
  if (graph.nodes.length === 0) {
    return (
      <EmptyState title="No nodes yet.">
        Add one from the list beside this.
      </EmptyState>
    );
  }
  const { selected, connecting } = builder;
  return (
    <GraphView
      facts={facts}
      label={`Workflow ${builder.opened?.name ?? ""}`}
      layout={layout}
      onSelect={id => {
        if (connecting && selected !== null) {
          builder.setConnecting(false);
          void builder.edit(connectEdit(graph, selected, id));
          return;
        }
        builder.select(id);
      }}
      selected={selected ?? undefined}
    />
  );
};

export const BuilderBody = ({ builder }: { builder: Builder }) => {
  const { view } = builder;
  if (view === null) {
    return (
      <EmptyState title="No workflow open.">
        Choose one above, or name a new one. A workflow you make here is the
        same file you could write by hand, and works with every <code>ork</code>{" "}
        command.
      </EmptyState>
    );
  }
  return (
    <div className={styles["body"]}>
      <Palette builder={builder} />
      <div className={styles["middle"]}>
        <div className={styles["canvas"]}>
          <Canvas builder={builder} />
        </div>
        <Problems
          onChoose={builder.select}
          problems={view.diagnostics}
        />
      </div>
      <aside
        aria-label="Inspector"
        className={styles["inspector"]}
      >
        <Inspector builder={builder} />
      </aside>
    </div>
  );
};
