/**
 * @file Keeps the focus in a panel when the list item holding it goes: it moves
 *   to whatever now stands at that place in the list, or to the panel when the
 *   list is empty, rather than falling out to the page. An item that takes the
 *   focus itself gets it; otherwise its first button does. Any other focused
 *   element that goes (a Clear filter button, a dialog closed with its card)
 *   sends the focus to the panel.
 */

import { type FocusEvent, useEffect, useRef } from "react";

const targetIn = (item: HTMLElement): HTMLElement | null =>
  item.tabIndex >= 0 ? item : item.querySelector("button");

export const useKeptFocus = (
  /** Changes when the list's items do. */
  listKey: string,
  /** What finds an item in the panel. */
  itemSelector: string,
) => {
  const panel = useRef<HTMLDivElement>(null);
  /** Where in the list the focus last was. */
  const focusedAt = useRef<number | null>(null);
  const lastKey = useRef(listKey);
  /** The element that last took the focus in the panel, portals included. */
  const focused = useRef<EventTarget | null>(null);

  useEffect(() => {
    if (listKey === lastKey.current) return;
    lastKey.current = listKey;
    const at = focusedAt.current;
    if (at === null || document.activeElement !== document.body) return;
    const items = panel.current?.querySelectorAll<HTMLElement>(itemSelector);
    const next = items?.[Math.min(at, (items.length || 1) - 1)];
    ((next === undefined ? null : targetIn(next)) ?? panel.current)?.focus();
  }, [listKey, itemSelector]);

  // After every render: a focused element that is gone left the focus on the
  // page, so it goes to the panel (the card-to-card move above comes first).
  useEffect(() => {
    const gone = focused.current;
    if (!(gone instanceof Node) || gone.isConnected) return;
    focused.current = null;
    if (document.activeElement === document.body) panel.current?.focus();
  });

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const { target, currentTarget } = event;
    focused.current = target;
    const item =
      target instanceof Element
        ? target.closest<HTMLElement>(itemSelector)
        : null;
    focusedAt.current =
      item === null
        ? null
        : [
            ...currentTarget.querySelectorAll<HTMLElement>(itemSelector),
          ].indexOf(item);
  };

  return { panel, onFocus };
};
