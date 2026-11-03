/**
 * @file Keeps the focus in a panel when the list item holding it goes: it moves
 *   to whatever now stands at that place in the list, or to the panel when the
 *   list is empty, rather than falling out to the page. An item that takes the
 *   focus itself gets it; otherwise its first button does.
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

  useEffect(() => {
    if (listKey === lastKey.current) return;
    lastKey.current = listKey;
    const at = focusedAt.current;
    if (at === null || document.activeElement !== document.body) return;
    const items = panel.current?.querySelectorAll<HTMLElement>(itemSelector);
    const next = items?.[Math.min(at, (items.length || 1) - 1)];
    ((next === undefined ? null : targetIn(next)) ?? panel.current)?.focus();
  }, [listKey, itemSelector]);

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const { target, currentTarget } = event;
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
