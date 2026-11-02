/** @file One titled section of the gallery. */

import type { ReactNode } from "react";

import styles from "./gallery.module.css";

export const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className={styles["section"]}>
    <h2 className={styles["heading"]}>{title}</h2>
    <div className={styles["row"]}>{children}</div>
  </section>
);
