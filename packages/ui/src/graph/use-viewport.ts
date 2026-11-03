/**
 * @file The graph's pan and zoom. The transform is written straight to the
 *   layer in an animation frame, so moving the view renders nothing in React;
 *   React hears only when what is on screen changes, for drawing just that. The
 *   dots move and scale with it. Until the user moves it, the view keeps the
 *   drawing fitted as the panel resizes.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { coveredBy, onResize, onWheel } from "./canvas-dom.ts";
import type { GraphLayout, Point } from "./types.ts";
import {
  type Box,
  boxOf,
  dotSpacing,
  fitView,
  onScreen,
  overlaps,
  panBy,
  reveal,
  type Size,
  type View,
  zoomAt,
} from "./viewport.ts";

const WHEEL_ZOOM = 0.01;

export type Shown = {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<number>;
};

export type Viewport = {
  canvasRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  /** The buttons over the canvas, which a shown node must not sit under. */
  controlsRef: RefObject<HTMLDivElement | null>;
  shown: Shown;
  fit: () => void;
  /** Zooms around the canvas's middle. */
  zoom: (factor: number) => void;
  pan: (dx: number, dy: number) => void;
  /** Pans the least it must to show this part of the drawing. */
  show: (box: Box) => void;
  pointer: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
};

const everything = (layout: GraphLayout): Shown => ({
  nodes: new Set(layout.nodes.map(node => node.id)),
  edges: new Set(layout.edges.keys()),
});

const nothing = (): void => {
  // An effect with nothing to clean up.
};

const distance = (a: Point, b: Point): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const useViewport = (layout: GraphLayout): Viewport => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const moved = useRef(false);
  const frame = useRef(0);
  const pointers = useRef(new Map<number, Point>());
  const [shown, setShown] = useState<Shown>(() => everything(layout));
  const shownKey = useRef("");
  // A new drawing shows whole until its first frame says what is on screen.
  const [shownFor, setShownFor] = useState(layout);
  if (layout !== shownFor) {
    setShownFor(layout);
    setShown(everything(layout));
  }

  const edgeBoxes = useMemo(
    () => layout.edges.map(edge => boxOf(edge.points)),
    [layout],
  );

  const sizeOf = useCallback((): Size => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);

  /** Writes the view to the page, and tells React if what shows has changed. */
  const flush = useCallback(() => {
    frame.current = 0;
    const { x, y, k } = view.current;
    const layer = layerRef.current;
    if (layer !== null) {
      layer.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(k)})`;
    }
    const canvas = canvasRef.current;
    if (canvas !== null) {
      const spacing = `${String(dotSpacing(k))}px`;
      canvas.style.backgroundSize = `${spacing} ${spacing}`;
      canvas.style.backgroundPosition = `${String(x)}px ${String(y)}px`;
      // The focus ring scales with its card, and must stay as thick as any.
      canvas.style.setProperty("--graph-zoom", String(k));
    }
    const size = sizeOf();
    // With no size yet, as in a hidden panel, nothing can be ruled out.
    if (size.width === 0 || size.height === 0) return;
    const box = onScreen(view.current, size);
    const nodes = layout.nodes
      .filter(node => overlaps(box, node))
      .map(node => node.id);
    const edges = [...edgeBoxes.keys()].filter(index => {
      const edge = edgeBoxes[index];
      return edge !== undefined && overlaps(box, edge);
    });
    const key = `${nodes.join("\n")}\n\n${edges.join(",")}`;
    if (key !== shownKey.current) {
      shownKey.current = key;
      setShown({ nodes: new Set(nodes), edges: new Set(edges) });
    }
  }, [edgeBoxes, layout, sizeOf]);

  const schedule = useCallback(() => {
    if (frame.current === 0) frame.current = requestAnimationFrame(flush);
  }, [flush]);

  const fit = useCallback(() => {
    moved.current = false;
    view.current = fitView(layout, sizeOf());
    schedule();
  }, [layout, schedule, sizeOf]);

  const moveTo = useCallback(
    (next: View) => {
      moved.current = true;
      view.current = next;
      schedule();
    },
    [schedule],
  );

  const zoom = useCallback(
    (factor: number) => {
      const { width, height } = sizeOf();
      moveTo(zoomAt(view.current, factor, { x: width / 2, y: height / 2 }));
    },
    [moveTo, sizeOf],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      moveTo(panBy(view.current, dx, dy));
    },
    [moveTo],
  );

  const show = useCallback(
    (box: Box) => {
      const size = sizeOf();
      if (size.width === 0 || size.height === 0) return;
      const next = reveal(
        view.current,
        box,
        size,
        coveredBy(controlsRef, canvasRef),
      );
      if (next !== view.current) moveTo(next);
    },
    [moveTo, sizeOf],
  );

  // A new drawing starts fitted, and a resized panel stays fitted, until moved.
  useEffect(() => {
    shownKey.current = "";
    // A worker spawned while the user looks around must not move their view.
    if (moved.current) schedule();
    else fit();
  }, [fit, schedule]);

  useEffect(() => {
    const canvas = canvasRef.current;
    return canvas === null
      ? nothing
      : onResize(canvas, () => {
          if (moved.current) schedule();
          else fit();
        });
  }, [fit, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    return canvas === null
      ? nothing
      : onWheel(canvas, event => {
          if (event.ctrlKey || event.metaKey) {
            const rect = canvas.getBoundingClientRect();
            moveTo(
              zoomAt(view.current, Math.exp(-event.deltaY * WHEEL_ZOOM), {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              }),
            );
          } else {
            moveTo(panBy(view.current, -event.deltaX, -event.deltaY));
          }
        });
  }, [moveTo]);

  const pointer = useMemo<Viewport["pointer"]>(() => {
    const here = (event: React.PointerEvent<HTMLDivElement>): Point => {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const release = (event: React.PointerEvent<HTMLDivElement>): void => {
      pointers.current.delete(event.pointerId);
    };
    return {
      onPointerDown: event => {
        // A press on a card or a control is theirs.
        if (
          event.target instanceof Element &&
          event.target.closest("button") !== null
        ) {
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointers.current.set(event.pointerId, here(event));
      },
      onPointerMove: event => {
        const before = pointers.current.get(event.pointerId);
        if (before === undefined) return;
        const now = here(event);
        const other = [...pointers.current].find(
          ([id]) => id !== event.pointerId,
        )?.[1];
        if (other === undefined) {
          moveTo(panBy(view.current, now.x - before.x, now.y - before.y));
        } else {
          // Two fingers: pinching zooms around the one that stays.
          const span = distance(before, other);
          if (span > 0) {
            moveTo(zoomAt(view.current, distance(now, other) / span, other));
          }
        }
        pointers.current.set(event.pointerId, now);
      },
      onPointerUp: release,
      onPointerCancel: release,
    };
  }, [moveTo]);

  return {
    canvasRef,
    layerRef,
    controlsRef,
    shown,
    fit,
    zoom,
    pan,
    show,
    pointer,
  };
};
