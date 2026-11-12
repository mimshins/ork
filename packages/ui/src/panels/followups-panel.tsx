/**
 * @file The Follow-ups panel: what shipped changes left for later, grouped by
 *   due and by who it is for, and what a person does with one, the UI twin of
 *   `ork follow-ups list | show | add | done | drop | reopen | due | post`.
 *   Apart from Feedback: it never lists a feedback item. A wide panel shows the
 *   list beside the chosen follow-up; a narrow one shows one in the other's
 *   place. Choosing is the person's act, never done for them.
 */

import { EmptyState } from "../components/bits.tsx";
import type { FollowUpRow } from "../state/follow-ups.ts";
import { FollowUpDetailCard } from "./followups-detail.tsx";
import { FollowUpsList } from "./followups-list.tsx";
import { noMatchWords, nowMs } from "./followups-model.ts";
import {
  FollowUpsTools,
  projectsWithRows,
  ReadFailed,
} from "./followups-tools.tsx";
import { useFollowUps, type FollowUpsView } from "./use-followups.ts";

import styles from "./followups.module.css";

/** What the list says with nothing to show, and the next step. */
const NoRows = ({ rows }: { rows: readonly FollowUpRow[] }) =>
  rows.length === 0 ? (
    <EmptyState
      cli="ork follow-ups add"
      title="No follow-ups yet."
    >
      {"A run adds one when a change leaves work for later. Add one yourself:"}
    </EmptyState>
  ) : (
    <p className={styles["message"]}>{noMatchWords(rows)}</p>
  );

const ListCard = ({ view }: { view: FollowUpsView }) => {
  const { read, all, rows, shown, chosen } = view;
  const failed = read.status === "failed";
  return (
    <div
      aria-label="Follow-up list"
      className={`${styles["card"] ?? ""} ${failed ? (styles["stale"] ?? "") : ""}`}
      data-followups-list=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus lands when the list empties, not a form's fieldset
      role="group"
      tabIndex={-1}
    >
      {failed ? (
        <ReadFailed
          error={read.error}
          onRetry={view.reload}
        />
      ) : null}
      {failed && shown.length > 0 ? (
        <p className={styles["note"]}>From the last read</p>
      ) : null}
      {all === null && !failed ? (
        <output className={styles["message"]}>Reading follow-ups…</output>
      ) : null}
      {all !== null && shown.length === 0 ? <NoRows rows={rows} /> : null}
      {shown.length === 0 ? null : (
        <FollowUpsList
          chosen={chosen}
          onChoose={view.choose}
          rows={shown}
          showProject={
            view.filter.project === "all" && projectsWithRows(rows).length > 1
          }
          today={nowMs()}
        />
      )}
    </div>
  );
};

const DetailCard = ({ view }: { view: FollowUpsView }) => {
  const { row, narrow, gone } = view;
  return (
    <div
      className={styles["card"]}
      data-followups-detail=""
    >
      {row === undefined ? null : (
        <FollowUpDetailCard
          row={row}
          view={view}
        />
      )}
      {row === undefined && gone ? (
        <p className={styles["message"]}>
          That follow-up is no longer in this list.
        </p>
      ) : null}
      {row === undefined && !gone && !narrow ? (
        <p className={styles["message"]}>Choose a follow-up to read it.</p>
      ) : null}
    </div>
  );
};

export const FollowUpsPanel = () => {
  const view = useFollowUps();
  const { read, all, filter, showing, root } = view;
  return (
    <div
      aria-label="Follow-ups"
      className={styles["panel"]}
      data-layout={view.narrow ? "narrow" : "wide"}
      ref={root}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus can land, not a landmark: the dock names the panel
      role="group"
      tabIndex={-1}
    >
      <FollowUpsTools
        failed={read.status === "failed"}
        filter={filter}
        onFilter={view.setFilter}
        onReload={view.reload}
        read={all}
        updating={read.status === "loading" && all !== null}
      />
      <div className={styles["body"]}>
        {showing === "detail" ? null : <ListCard view={view} />}
        {showing === "list" ? null : <DetailCard view={view} />}
      </div>
    </div>
  );
};
