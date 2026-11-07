/**
 * @file What a person can do with an item, in the Feedback panel. Which buttons
 *   show depends on what it's about (an `ork` item has no lesson or fix, a
 *   project's no publish); whether each is enabled, and why not, is the
 *   server's answer, by the rule `ork feedback` keeps too. A disabled button
 *   stays focusable and says why. Dismiss and Restore undo each other, so they
 *   don't ask; Propose fix starts a paid run, so it does (fix-dialog.tsx).
 */

import type { FeedbackDetail, FeedbackItem } from "@krapht/ork-server/client";
import { useState } from "react";

import { Button } from "../components/button.tsx";
import { useAppState } from "../state/context.tsx";
import { buttonsFor, labelOf, short } from "./feedback-model.ts";
import { FixDialog } from "./fix-dialog.tsx";
import { LessonDialog } from "./lesson-dialog.tsx";
import { PublishDialog } from "./publish-dialog.tsx";
import type { FeedbackActs } from "./use-feedback-acts.ts";

import styles from "./feedback.module.css";

type Open = "lesson" | "apply" | "publish" | null;

export const ItemActions = ({
  item,
  detail,
  acts,
}: {
  item: FeedbackItem;
  detail: FeedbackDetail | null;
  acts: FeedbackActs;
}) => {
  const state = useAppState();
  const [open, setOpen] = useState<Open>(null);
  /** Each opening starts a dialog afresh. */
  const [opened, setOpened] = useState(0);
  const id = short(item.id);
  const dismissed = item.status === "dismissed";
  const show = (which: Open): void => {
    setOpened(count => count + 1);
    setOpen(which);
  };
  const shut = (next: boolean): void => {
    if (!next) setOpen(null);
  };
  const run = (key: string): void => {
    if (key === "accept") void acts.accept(item);
    else
      show(key === "lesson" ? "lesson" : key === "apply" ? "apply" : "publish");
  };
  return (
    <>
      <div
        aria-label={`Actions on ${id}`}
        className={styles["actions"]}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset is for form fields, and these are actions
        role="group"
      >
        {buttonsFor(item, detail).map(({ key, word, cli, variant, check }) => (
          <Button
            aria-label={labelOf(word, check)}
            cli={cli}
            disabled={!check.ok}
            focusableWhenDisabled
            key={key}
            onClick={() => {
              run(key);
            }}
            tip={check.ok ? undefined : check.why}
            variant={variant}
          >
            {word}
          </Button>
        ))}
        <Button
          cli={`ork feedback ${dismissed ? "restore" : "dismiss"} ${id}`}
          key="status"
          onClick={() => {
            void acts.setStatus(item, dismissed ? "new" : "dismissed");
          }}
          variant="ghost"
        >
          {dismissed ? "Restore" : "Dismiss"}
        </Button>
      </div>
      {item.target === "ork" ? (
        <p className={styles["note"]}>
          {
            "About Ork itself: it has no lesson or fix in your projects. Publish shares it with Ork's maintainers."
          }
        </p>
      ) : null}
      {detail === null ? null : (
        <LessonDialog
          detail={detail}
          item={item}
          key={`lesson-${String(opened)}`}
          onAdd={body => acts.addLesson(item, body, detail.lessonCap)}
          onOpenChange={shut}
          open={open === "lesson"}
        />
      )}
      <FixDialog
        acts={acts}
        id={id}
        item={item}
        key={`fix-${String(opened)}`}
        onOpenChange={shut}
        open={open === "apply"}
        root={detail?.project.ok === true ? detail.project.root : null}
      />
      {item.target === "ork" ? (
        <PublishDialog
          client={state.client}
          id={id}
          item={item.id}
          key={`publish-${String(opened)}`}
          onCancelled={() => {
            acts.announce("Nothing was sent.");
          }}
          onOpenChange={shut}
          onPosted={() => {
            void acts.reloadAll();
          }}
          open={open === "publish"}
        />
      ) : null}
    </>
  );
};
