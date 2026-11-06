/**
 * @file An item in the Feedback panel: its title (the heading, where the focus
 *   goes), its status, its facts, a fix in progress, what can be done with it,
 *   its records and its CLI twin. The header and the actions show from the
 *   list's item while its records are read. Escape goes back to its row.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";
import { useId } from "react";

import { CopyCommand } from "../components/copy-command.tsx";
import { ItemStatusBadge } from "../components/status-badge.tsx";
import { ItemActions } from "./feedback-actions.tsx";
import { BackToItems, FixLine, ItemFacts } from "./feedback-facts.tsx";
import { ItemRecords } from "./feedback-records.tsx";
import type { FeedbackActs } from "./use-feedback-acts.ts";
import type { DetailRead } from "./use-feedback.ts";

import styles from "./feedback.module.css";

export const ItemDetail = ({
  item,
  read,
  acts,
  narrow,
  onBack,
  onLeave,
}: {
  item: FeedbackItem;
  read: DetailRead;
  acts: FeedbackActs;
  narrow: boolean;
  onBack: () => void;
  /** Escape: back to the item's row. */
  onLeave: () => void;
}) => {
  const heading = useId();
  const fixRun = read.detail?.fixRun;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from the controls inside
    <section
      aria-labelledby={heading}
      className={styles["detail"]}
      onKeyDown={event => {
        // Escape is a dialog's or a tooltip's while one is open.
        const modalOpen = document.querySelector("[data-modal]") !== null;
        if (event.key === "Escape" && !modalOpen) onLeave();
      }}
    >
      {narrow ? <BackToItems onBack={onBack} /> : null}
      <div className={styles["head"]}>
        <h2
          className={styles["title"]}
          data-feedback-heading=""
          id={heading}
          tabIndex={-1}
        >
          {item.title}
        </h2>
        <ItemStatusBadge
          pill
          status={item.status}
        />
      </div>
      <ItemFacts
        item={item}
        onSplit={() => {
          void acts.split(item);
        }}
      />
      {fixRun === undefined ? null : (
        <FixLine
          onOpen={acts.openRun}
          run={fixRun}
        />
      )}
      <ItemActions
        acts={acts}
        detail={read.detail}
        item={item}
      />
      <ItemRecords
        item={item}
        onOpenRun={acts.openRun}
        read={read}
      />
      <CopyCommand command={`ork feedback show ${item.id.slice(0, 12)}`} />
    </section>
  );
};
