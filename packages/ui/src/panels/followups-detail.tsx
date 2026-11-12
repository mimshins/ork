/**
 * @file A follow-up in the Follow-ups panel: its title (the heading, where the
 *   focus goes) and status, what can be done with it (each button with its CLI
 *   twin; a disabled one stays focusable and says why), then its facts, body,
 *   draft and steps (followups-parts.tsx). Escape goes back to its row.
 */

import { useId, useState } from "react";

import { FollowUpStatusBadge } from "../components/status-badge.tsx";
import { Actions } from "./followups-actions.tsx";
import { Body, ReadError, ShowTwin } from "./followups-body.tsx";
import { BackToFollowUps, Facts } from "./followups-facts.tsx";
import { type FollowUpRow, isSent, short } from "./followups-model.ts";
import { ClosedNote, Draft, Steps, TakeInRun } from "./followups-parts.tsx";
import { PostDialog } from "./followups-post-dialog.tsx";
import type { FollowUpsView } from "./use-followups.ts";

import styles from "./followups.module.css";

export const FollowUpDetailCard = ({
  row,
  view,
}: {
  row: FollowUpRow;
  view: FollowUpsView;
}) => {
  const heading = useId();
  const { detail } = view.detail;
  const [posting, setPosting] = useState(false);
  const digest = detail?.draftDigest;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from the controls inside
    <section
      aria-labelledby={heading}
      className={styles["detail"]}
      onKeyDown={event => {
        // Escape is a dialog's or a tooltip's while one is open.
        const modalOpen = document.querySelector("[data-modal]") !== null;
        if (event.key === "Escape" && !modalOpen && !event.defaultPrevented)
          view.back();
      }}
    >
      {view.narrow ? <BackToFollowUps onBack={view.back} /> : null}
      <div className={styles["head"]}>
        <h3
          className={styles["title"]}
          data-followups-heading=""
          id={heading}
          tabIndex={-1}
        >
          {row.title}
        </h3>
        <FollowUpStatusBadge
          pill
          sent={isSent(row)}
          status={row.status}
        />
      </div>
      <Actions
        actions={detail?.actions}
        onAct={key => {
          void view.act(row, key);
        }}
        row={row}
      />
      <TakeInRun row={row} />
      <ClosedNote
        detail={detail}
        row={row}
      />
      <Facts
        detail={detail}
        onOpenRun={view.openRun}
        projects={view.all?.projects ?? []}
        row={row}
      />
      <Body text={row.body} />
      <Draft
        detail={detail}
        gh={view.all?.checker.available ?? true}
        onPost={() => {
          setPosting(true);
        }}
        row={row}
      />
      <Steps row={row} />
      <ReadError
        error={view.detail.error}
        id={short(row.id)}
      />
      <ShowTwin row={row} />
      {detail === null || digest === undefined ? null : (
        <PostDialog
          detail={detail}
          onOpenChange={next => {
            if (!next) {
              setPosting(false);
              view.announce("Cancelled. Nothing was posted.");
            }
          }}
          onPost={() => view.post(row, digest)}
          open={posting}
          row={row}
        />
      )}
    </section>
  );
};
