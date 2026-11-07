/**
 * @file A sunken well of text to read as it is (a plan, git's lines), in
 *   monospace, wrapped, scrolling past its height. It's a named region the keys
 *   can reach and scroll; while what it holds is read, it says so and is busy.
 *   Its look's heights come from whoever places it.
 */

import type { ReactNode, Ref } from "react";

import { CodeText } from "./code-text.tsx";

import styles from "./text-well.module.css";

export type TextWellProps = {
  /** The region's name: "Plan", "Uncommitted changes". */
  label: string;
  /** The words while it's read; the well is busy meanwhile. */
  reading?: string | undefined;
  /** Its description's id, such as a summary of what it holds. */
  describedBy?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  /** Keeps room for a line or two, so a read doesn't move what's below. */
  steady?: boolean;
  /** Shorter, for a well among others. */
  short?: boolean;
  children: ReactNode;
};

export const TextWell = ({
  label,
  reading,
  describedBy,
  ref,
  steady = false,
  short = false,
  children,
}: TextWellProps) => (
  <section
    aria-busy={reading !== undefined}
    aria-describedby={describedBy}
    aria-label={label}
    className={styles["well"]}
    data-short={short ? "" : undefined}
    data-steady={steady ? "" : undefined}
    ref={ref}
    // Focusable, so the keys scroll it.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keys must reach
    tabIndex={0}
  >
    {reading === undefined ? children : <CodeText text={reading} />}
  </section>
);
