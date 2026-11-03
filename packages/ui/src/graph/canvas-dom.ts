/**
 * @file What the graph's view needs from the page: hearing the canvas resize
 *   and wheel, and where something over the canvas sits on it.
 */

import type { RefObject } from "react";

import type { Box } from "./viewport.ts";

export const onResize = (element: Element, call: () => void): (() => void) => {
  const observer = new ResizeObserver(call);
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};

/** React's wheel listener is passive, and this must stop the page moving. */
export const onWheel = (
  element: Element,
  call: (event: WheelEvent) => void,
): (() => void) => {
  const listener = (event: Event): void => {
    event.preventDefault();
    if (event instanceof WheelEvent) call(event);
  };
  element.addEventListener("wheel", listener, { passive: false });
  return () => {
    element.removeEventListener("wheel", listener);
  };
};

/** Where `over` sits on `canvas`, in the canvas's pixels. */
export const coveredBy = (
  over: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLElement | null>,
): Box | undefined => {
  const box = over.current?.getBoundingClientRect();
  const origin = canvas.current?.getBoundingClientRect();
  return box === undefined || origin === undefined
    ? undefined
    : {
        x: box.x - origin.x,
        y: box.y - origin.y,
        width: box.width,
        height: box.height,
      };
};
