/**
 * @file Small pieces of copy with a fixed form: the key hint, and the empty
 *   state, which says what is missing and teaches the next step.
 */

import type { ReactNode } from "react";

import styles from "./bits.module.css";

/** One key combination, one `<kbd>` per key: `<Kbd keys={["⌘", "K"]} />`. */
export const Kbd = ({ keys }: { keys: readonly string[] }) => (
  <span className={styles["keys"]}>
    {keys.map(key => (
      <kbd
        className={styles["key"]}
        key={key}
      >
        {key}
      </kbd>
    ))}
  </span>
);

export type EmptyStateProps = {
  /** What is missing: "No runs yet." */
  title: string;
  /** The next step, with its CLI twin. */
  children: ReactNode;
};

export const EmptyState = ({ title, children }: EmptyStateProps) => (
  <div className={styles["empty"]}>
    <p className={styles["emptyTitle"]}>{title}</p>
    <div className={styles["emptyBody"]}>{children}</div>
  </div>
);
