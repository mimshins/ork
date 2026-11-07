/**
 * @file The empty state: a piece of copy with a fixed form, which says what is
 *   missing and teaches the next step, with the step's command as a code block
 *   under its words. The key hint, which shares its sheet, is in kbd.tsx.
 */

import type { ReactNode } from "react";

import { CopyCommand } from "./copy-command.tsx";

import styles from "./bits.module.css";

export type EmptyStateProps = {
  /** What is missing: "No runs yet." */
  title: string;
  /** The next step, in words; a sentence that leads to `cli` ends in a colon. */
  children: ReactNode;
  /** The next step's command, shown as a code block under the words. */
  cli?: string | undefined;
  /**
   * The title can take the focus (not by Tab), for a list whose last item went:
   * `[data-empty-title]` finds it.
   */
  focusable?: boolean;
};

export const EmptyState = ({
  title,
  children,
  cli,
  focusable = false,
}: EmptyStateProps) => (
  <div className={styles["empty"]}>
    <p
      className={styles["emptyTitle"]}
      data-empty-title={focusable ? "" : undefined}
      tabIndex={focusable ? -1 : undefined}
    >
      {title}
    </p>
    <div className={styles["emptyBody"]}>{children}</div>
    {cli === undefined ? null : (
      <div className={styles["emptyCommand"]}>
        <CopyCommand command={cli} />
      </div>
    )}
  </div>
);
