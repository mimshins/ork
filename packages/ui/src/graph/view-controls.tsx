/**
 * @file The buttons that move the graph's view: zoom, fit and pan, so that all
 *   of it can be done with a single press as well as by dragging (WCAG 2.5.7),
 *   and Keys, which shows every key the graph takes, on the view and on a card,
 *   since a card's keys have no button whose tooltip could show them.
 */

import { IconButton } from "../components/button.tsx";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconFit,
  IconKeyboard,
  IconPlus,
  IconMinus,
} from "../components/icons.tsx";
import { Kbd } from "../components/kbd.tsx";
import { Popover } from "../components/popover.tsx";

import styles from "./graph.module.css";

export const PAN_STEP = 48;
export const ZOOM_STEP = 1.25;

/** Each key the graph takes, as the canvas's description says them. */
export const GRAPH_KEYS: readonly {
  keys: readonly (readonly string[])[];
  does: string;
}[] = [
  {
    keys: [["←"], ["→"], ["↑"], ["↓"]],
    does: "Move the view; on a node, follow its edges",
  },
  { keys: [["Enter"], ["Space"]], does: "Select the node" },
  { keys: [["Shift", "F10"]], does: "The node's controls" },
  { keys: [["Escape"]], does: "Back to the view" },
  { keys: [["+"], ["-"]], does: "Zoom in or out" },
  { keys: [["0"]], does: "Fit the graph" },
];

const GraphKeys = () => (
  <Popover
    title="Keys on the graph"
    trigger={
      <IconButton label="Keys on the graph">
        <IconKeyboard />
      </IconButton>
    }
  >
    <dl className={styles["keyList"]}>
      {GRAPH_KEYS.map(({ keys, does }) => (
        <div
          className={styles["keyRow"]}
          key={does}
        >
          <dt className={styles["keyNames"]}>
            {keys.map(combination => (
              <Kbd
                key={combination.join("+")}
                keys={combination}
              />
            ))}
          </dt>
          <dd className={styles["keyDoes"]}>{does}</dd>
        </div>
      ))}
    </dl>
  </Popover>
);

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
      <IconMinus />
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
    <GraphKeys />
  </div>
);
