/**
 * @file What the UI's tests add to jsdom: a window width for `matchMedia` (a
 *   test can change it and the query reports the change), a `ResizeObserver`,
 *   which dockview needs and jsdom lacks. The `EventSource` a test drives is in
 *   fake-source.ts.
 */

import { vi } from "vitest";

type Listener = () => void;

/** Installs the stubs, and returns the way to change the window's width. */
export const stubWindow = (
  startWide = true,
): { setWide: (wide: boolean) => void } => {
  let wide = startWide;
  const listeners = new Set<Listener>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return wide;
    },
    addEventListener: (_: string, listener: Listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: Listener) => {
      listeners.delete(listener);
    },
  }));
  return {
    setWide: next => {
      wide = next;
      for (const listener of listeners) listener();
    },
  };
};
