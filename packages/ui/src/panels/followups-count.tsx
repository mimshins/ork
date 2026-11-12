/**
 * @file The Follow-ups tab's and rail button's count of what is due: a mono
 *   number in amber after the title, `99+` past 99, spelled out in words for a
 *   screen reader. It follows the overview stream, so it stays true with the
 *   panel hidden.
 */

import { useValue } from "react-containerized-state";

import { Unseen } from "../components/unseen.tsx";
import { useAppState } from "../state/context.tsx";

import styles from "./followups.module.css";

/** How many are due, as the tab writes it. */
export const dueCountWords = (count: number): string =>
  count > 99 ? "99+" : String(count);

/** The count after a title: nothing when none is due. */
export const FollowUpsCount = () => {
  const { count } = useValue(useAppState().followUpsDue);
  if (count === 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className={styles["tabCount"]}
      >
        {dueCountWords(count)}
      </span>
      <Unseen>{`, ${String(count)} due`}</Unseen>
    </>
  );
};

/** The due count for a name ("Follow-ups, 3 due"), without drawing it. */
export const useDueName = (title: string): string => {
  const { count } = useValue(useAppState().followUpsDue);
  return count === 0 ? title : `${title}, ${String(count)} due`;
};
