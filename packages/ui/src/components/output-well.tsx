/**
 * @file A program's output, as it writes it: a sunken, monospace, wrapped,
 *   scrolling region with a name, which the keys can scroll once it has the
 *   focus. It follows the end while the scroll is at the end, and holds still
 *   when scrolled up, as the Logs panel does. It's not a live region: a screen
 *   reader isn't read every line.
 */

import { type RefObject, useLayoutEffect, useRef } from "react";

import styles from "./output-well.module.css";

/** How near the end counts as at it, for a wheel that stops a little short. */
const NEAR_END = 32;

export const OutputWell = ({
  label,
  text,
  ref,
}: {
  /** The region's name: "Output of pnpm". */
  label: string;
  text: string;
  /** The region, for whoever moves the focus to it. */
  ref?: RefObject<HTMLElement | null>;
}) => {
  const own = useRef<HTMLElement>(null);
  const region = ref ?? own;
  const following = useRef(true);
  useLayoutEffect(() => {
    const well = region.current;
    if (well !== null && following.current) well.scrollTop = well.scrollHeight;
  });
  return (
    <section
      aria-label={label}
      className={styles["well"]}
      onScroll={() => {
        const well = region.current;
        if (well === null) return;
        following.current =
          well.scrollHeight - well.scrollTop - well.clientHeight < NEAR_END;
      }}
      ref={region}
      // Focusable, so the keys scroll it.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keys must reach
      tabIndex={0}
    >
      {text}
    </section>
  );
};
