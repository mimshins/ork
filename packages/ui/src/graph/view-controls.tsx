/**
 * @file The buttons that move the graph's view: zoom, fit and pan, so that all
 *   of it can be done with a single press as well as by dragging (WCAG 2.5.7).
 */

import { IconButton } from "../components/button.tsx";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconFit,
  IconPlus,
  IconSkipped,
} from "../components/icons.tsx";

import styles from "./graph.module.css";

export const PAN_STEP = 48;
export const ZOOM_STEP = 1.25;

export const ViewControls = ({
  controlsRef,
  zoom,
  fit,
  pan,
}: {
  controlsRef: React.RefObject<HTMLDivElement | null>;
  zoom: (factor: number) => void;
  fit: () => void;
  pan: (dx: number, dy: number) => void;
}) => (
  <div
    className={styles["controls"]}
    ref={controlsRef}
  >
    <IconButton
      keys={["+"]}
      label="Zoom in"
      onClick={() => {
        zoom(ZOOM_STEP);
      }}
    >
      <IconPlus />
    </IconButton>
    <IconButton
      keys={["-"]}
      label="Zoom out"
      onClick={() => {
        zoom(1 / ZOOM_STEP);
      }}
    >
      <IconSkipped />
    </IconButton>
    <IconButton
      keys={["0"]}
      label="Fit the graph"
      onClick={fit}
    >
      <IconFit />
    </IconButton>
    <IconButton
      keys={["←"]}
      label="Pan left"
      onClick={() => {
        pan(PAN_STEP, 0);
      }}
    >
      <IconArrowLeft />
    </IconButton>
    <IconButton
      keys={["→"]}
      label="Pan right"
      onClick={() => {
        pan(-PAN_STEP, 0);
      }}
    >
      <IconArrowRight />
    </IconButton>
    <IconButton
      keys={["↑"]}
      label="Pan up"
      onClick={() => {
        pan(0, PAN_STEP);
      }}
    >
      <IconArrowUp />
    </IconButton>
    <IconButton
      keys={["↓"]}
      label="Pan down"
      onClick={() => {
        pan(0, -PAN_STEP);
      }}
    >
      <IconArrowDown />
    </IconButton>
  </div>
);
