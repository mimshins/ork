/**
 * @file The graph, in-house (specs/ui/graph.md): edges as SVG and cards as
 *   buttons in one layer that pans and zooms, drawing only what is on screen.
 *   The canvas takes the keys for moving the view. The cards are one tab stop:
 *   the arrow keys move along the edges, Enter selects, and the context-menu
 *   key asks for the node's controls. A card says its edges in its description,
 *   and a node selected elsewhere comes into view.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { connectionsOf } from "./connections.ts";
import { EdgePaths } from "./edge-paths.tsx";
import type { NodeFacts } from "./facts.ts";
import { type Direction, moveFrom } from "./moves.ts";
import { NodeCard } from "./node-card.tsx";
import type { GraphLayout } from "./types.ts";
import { useViewport } from "./use-viewport.ts";
import { PAN_STEP, ViewControls, ZOOM_STEP } from "./view-controls.tsx";

import styles from "./graph.module.css";

const NO_FACTS: NodeFacts = { status: "queued" };

const DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export type GraphViewProps = {
  layout: GraphLayout;
  /** What this graph is of, for its accessible name. */
  label: string;
  /** What each node's card says; a node with none reads as queued. */
  facts?: ReadonlyMap<string, NodeFacts> | undefined;
  selected?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** The context-menu key or a right click on a node. */
  onNodeMenu?: ((id: string) => void) | undefined;
  /** A run's graph: its edges show how far it has got. */
  live?: boolean | undefined;
  /** The node being pointed at, here or in the table beside it. */
  hovered?: string | null | undefined;
  onHover?: ((id: string | null) => void) | undefined;
};

const noSelect = (): void => {
  // A graph may be only for looking at.
};

export const GraphView = memo(
  ({
    layout,
    label,
    facts,
    selected,
    onSelect = noSelect,
    onNodeMenu,
    live = false,
    hovered = null,
    onHover,
  }: GraphViewProps) => {
    const hintId = useId();
    const {
      canvasRef,
      layerRef,
      controlsRef,
      shown,
      fit,
      zoom,
      pan,
      show,
      pointer,
    } = useViewport(layout);
    const [current, setCurrent] = useState(selected);
    // A newly selected node becomes the one Tab reaches.
    const [lastSelected, setLastSelected] = useState(selected);
    if (selected !== lastSelected) {
      setLastSelected(selected);
      if (selected !== undefined) setCurrent(selected);
    }
    const cards = useRef(new Map<string, HTMLButtonElement>());
    /** A card to focus once it has been drawn. */
    const toFocus = useRef<string | null>(null);

    const byId = useMemo(
      () => new Map(layout.nodes.map(node => [node.id, node])),
      [layout],
    );
    const connections = useMemo(() => connectionsOf(layout.edges), [layout]);
    const roving = byId.has(current ?? "") ? current : layout.nodes[0]?.id;

    // Only a new selection moves the view: not the drawing changing under it.
    const revealed = useRef(selected);
    useEffect(() => {
      if (selected === revealed.current) return;
      revealed.current = selected;
      const node = byId.get(selected ?? "");
      if (node !== undefined) show(node);
    }, [byId, selected, show]);

    useEffect(() => {
      const id = toFocus.current;
      if (id === null) return;
      const card = cards.current.get(id);
      if (card === undefined) return;
      toFocus.current = null;
      // The canvas clips, and the view moves by its own transform.
      card.focus({ preventScroll: true });
    });

    const bind = useCallback(
      (id: string, element: HTMLButtonElement | null) => {
        if (element === null) cards.current.delete(id);
        else cards.current.set(id, element);
      },
      [],
    );

    const onFocused = useCallback(
      (id: string) => {
        setCurrent(id);
        const node = byId.get(id);
        if (node !== undefined) show(node);
      },
      [byId, show],
    );

    const onKey = useCallback(
      (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
        const direction = DIRECTIONS[event.key];
        if (direction !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          const next = moveFrom(layout, id, direction);
          if (next === undefined) return;
          const node = byId.get(next);
          if (node !== undefined) show(node);
          toFocus.current = next;
          setCurrent(next);
          return;
        }
        if (event.key === "Escape") {
          canvasRef.current?.focus({ preventScroll: true });
          return;
        }
        const menuKey =
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey);
        if (menuKey && onNodeMenu !== undefined) {
          event.preventDefault();
          onNodeMenu(id);
        }
      },
      [byId, canvasRef, layout, onNodeMenu, show],
    );

    const onCanvasKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      // The browser's own zoom, and so on.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onCanvas = event.target === event.currentTarget;
      const moves: Readonly<Record<string, () => void>> = {
        "+": () => {
          zoom(ZOOM_STEP);
        },
        "=": () => {
          zoom(ZOOM_STEP);
        },
        "-": () => {
          zoom(1 / ZOOM_STEP);
        },
        "0": fit,
        ...(onCanvas
          ? {
              ArrowLeft: () => {
                pan(PAN_STEP, 0);
              },
              ArrowRight: () => {
                pan(-PAN_STEP, 0);
              },
              ArrowUp: () => {
                pan(0, PAN_STEP);
              },
              ArrowDown: () => {
                pan(0, -PAN_STEP);
              },
            }
          : {}),
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        move();
      }
    };

    const nodes = layout.nodes.filter(
      node => shown.nodes.has(node.id) || node.id === roving,
    );
    const edges = useMemo(
      () => layout.edges.filter((_, index) => shown.edges.has(index)),
      [layout, shown],
    );

    return (
      <div className={styles["graph"]}>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- an application takes its own keys */}
        <div
          {...pointer}
          aria-describedby={hintId}
          aria-label={label}
          aria-roledescription="graph"
          className={styles["canvas"]}
          onKeyDown={onCanvasKey}
          ref={canvasRef}
          role="application"
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys that move the view need a place to land
          tabIndex={0}
        >
          <p
            className={styles["hint"]}
            id={hintId}
          >
            Arrow keys move the view; on a node, they move along its edges,
            Enter selects it, Shift+F10 asks for its controls, and Escape goes
            back to the view. Plus and minus zoom, and 0 fits the graph.
          </p>
          <div
            className={styles["layer"]}
            ref={layerRef}
          >
            <EdgePaths
              edges={edges}
              facts={live ? facts : undefined}
              height={layout.height}
              quiet={hovered !== null}
              width={layout.width}
            />
            {nodes.map(node => (
              <NodeCard
                bind={bind}
                connections={connections.get(node.id)}
                dimmed={hovered !== null && hovered !== node.id}
                facts={facts?.get(node.id) ?? NO_FACTS}
                key={node.id}
                node={node}
                onFocused={onFocused}
                onHover={onHover}
                onKey={onKey}
                onMenu={onNodeMenu}
                onSelect={onSelect}
                selected={node.id === selected}
                tabbable={node.id === roving}
              />
            ))}
          </div>
        </div>
        <ViewControls
          controlsRef={controlsRef}
          fit={fit}
          pan={pan}
          zoom={zoom}
        />
      </div>
    );
  },
);
GraphView.displayName = "GraphView";
