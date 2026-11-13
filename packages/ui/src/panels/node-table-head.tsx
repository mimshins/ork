/**
 * @file The Monitor's nodes table head: the column names, and a first cell that
 *   folds the table away so the graph gets its room. Whether it is folded is
 *   remembered by this browser, for every run.
 */

import { useState } from "react";

import { IconChevronDown, IconChevronRight } from "../components/icons.tsx";
import { browserStorage } from "../state/storage.ts";

import styles from "./monitor.module.css";

/** The table's chevron: down when what it opens is open. */
export const Chevron = ({ open }: { open: boolean }) =>
  open ? <IconChevronDown /> : <IconChevronRight />;

/** Where this browser remembers that the nodes table is folded away. */
const FOLDED_KEY = "ork.monitor.nodesFolded";

const foldedAtStart = (): boolean => {
  try {
    return browserStorage().getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
};

/** Whether the table is folded, and a toggle that remembers it. */
export const useFolded = (): readonly [boolean, () => void] => {
  const [folded, setFolded] = useState(foldedAtStart);
  const toggle = () => {
    try {
      browserStorage().setItem(FOLDED_KEY, folded ? "0" : "1");
    } catch {
      // A browser that keeps nothing still folds it for this visit.
    }
    setFolded(!folded);
  };
  return [folded, toggle];
};

export const NodeTableHead = ({
  folded,
  onToggle,
  treeId,
  count,
}: {
  folded: boolean;
  onToggle: () => void;
  /** The tree the toggle shows and hides. */
  treeId: string;
  /** How many rows the tree has, said while it is folded. */
  count: number;
}) => (
  <div className={styles["tableHead"]}>
    <button
      aria-controls={treeId}
      aria-expanded={!folded}
      className={styles["tableFold"]}
      onClick={onToggle}
      title={folded ? "Show the nodes table" : "Fold the nodes table away"}
      type="button"
    >
      <Chevron open={!folded} />
      <span>{folded ? `Nodes (${String(count)})` : "Node"}</span>
    </button>
    {folded ? null : (
      <>
        <span
          aria-hidden="true"
          className={styles["treeType"]}
        >
          Type
        </span>
        <span aria-hidden="true">Status</span>
        <span aria-hidden="true">Now</span>
        <span
          aria-hidden="true"
          className={styles["treeTime"]}
        >
          Time
        </span>
        <span
          aria-hidden="true"
          className={styles["treeCost"]}
        >
          Cost
        </span>
      </>
    )}
  </div>
);
