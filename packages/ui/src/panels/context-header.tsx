/**
 * @file The Context panel's header: the node it shows (the panel's heading,
 *   where the focus goes), its type, where it's planned from, and the size of
 *   what Ork appends to its system prompt, then a line on what it was planned
 *   from and a way to plan it again, with its CLI twin.
 */

import type { ReactNode, RefObject } from "react";

import { Button } from "../components/button.tsx";
import { approx } from "./context-model.ts";

import styles from "./context.module.css";

export type ContextHeaderProps = {
  node: string;
  /** Known once it's planned. */
  type?: string | undefined;
  from: string;
  appendedTokens?: number | undefined;
  /** What it's planned from, in a sentence; none when nothing is planned. */
  planned: string | null;
  /** The button's words: "Reload", or "Try again" after a failed ask. */
  reload: string;
  updating: boolean;
  cli: string;
  onReload: () => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
  /** Lines under the first: what changed, a spawned worker, a failed ask. */
  children?: ReactNode;
};

/** Words with `≈` in them, which a screen reader hears as "about". */
export const Approx = ({ text }: { text: string }) =>
  text.split("≈").map((part, index) =>
    index === 0 ? (
      part
    ) : (
      // The parts of one string never reorder, so their place is who they are.
      // oxlint-disable-next-line react/no-array-index-key
      <span key={index}>
        <span aria-hidden="true">≈</span>
        <span className={styles["visuallyHidden"]}>about </span>
        {part}
      </span>
    ),
  );

const Fact = ({ name, value }: { name: string; value: string }) => (
  <div className={styles["fact"]}>
    <dt className={styles["factName"]}>{name}</dt>
    <dd className={styles["factValue"]}>
      <Approx text={value} />
    </dd>
  </div>
);

export const ContextHeader = ({
  node,
  type,
  from,
  appendedTokens,
  planned,
  reload,
  updating,
  cli,
  onReload,
  titleRef,
  children,
}: ContextHeaderProps) => (
  <header className={styles["header"]}>
    <dl className={styles["facts"]}>
      <div className={styles["fact"]}>
        <dt className={styles["factName"]}>Node</dt>
        <dd className={styles["factValue"]}>
          <h2
            className={styles["title"]}
            ref={titleRef}
            tabIndex={-1}
          >
            {node}
          </h2>
        </dd>
      </div>
      {type === undefined ? null : (
        <Fact
          name="Type"
          value={type}
        />
      )}
      <Fact
        name="From"
        value={from}
      />
      {appendedTokens === undefined ? null : (
        <Fact
          name="Appended"
          value={`${approx(appendedTokens)} tokens`}
        />
      )}
    </dl>
    <div className={styles["plannedLine"]}>
      {planned === null ? null : <p className={styles["planned"]}>{planned}</p>}
      {updating ? <span className={styles["updating"]}>Updating…</span> : null}
      <Button
        cli={cli}
        onClick={onReload}
        variant="ghost"
      >
        {reload}
      </Button>
    </div>
    {children}
  </header>
);
