/**
 * @file Words a screen reader needs and the eye doesn't: which edge a field is
 *   about, when the card around it already says so.
 */

import type { ReactNode } from "react";

import styles from "./field.module.css";

export const Unseen = ({ children }: { children: ReactNode }) => (
  <span className={styles["visuallyHidden"]}>{children}</span>
);
