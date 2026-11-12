/**
 * @file The Post to GitHub confirm dialog: wide, opening on Cancel, and it only
 *   posts what it shows. It sends the draft's digest, so the server refuses a
 *   draft that changed since the person read it, and the dialog then shows the
 *   new text. While it posts it can't be closed; a refusal stays in it, and the
 *   item stays as it was.
 */

import type { FollowUpDetail } from "@krapht/ork-server/client";

import { ConfirmDialog, type Confirmed } from "../components/dialog.tsx";
import { TextWell } from "../components/text-well.tsx";
import type { FollowUpRow } from "../state/follow-ups.ts";
import { githubTarget, short } from "./followups-model.ts";

import styles from "./followups.module.css";

export const PostDialog = ({
  row,
  detail,
  open,
  onOpenChange,
  onPost,
}: {
  row: FollowUpRow;
  detail: FollowUpDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves to the refusal, or null once it is posted. */
  onPost: () => Confirmed;
}) => {
  const draft = detail.followUp.draft;
  return (
    <ConfirmDialog
      cli={`ork follow-ups post ${short(row.id)} --confirm`}
      confirm="Post comment"
      description={`This posts the comment below to \`${githubTarget(draft?.to ?? "")}\` as you, through your \`gh\`. Ork sends nothing else.`}
      onConfirm={onPost}
      onOpenChange={onOpenChange}
      open={open}
      pending="Posting…"
      title="Post to GitHub?"
      variant="primary"
    >
      <TextWell label="Comment to post">
        <p className={styles["preview"]}>{draft?.text ?? ""}</p>
      </TextWell>
    </ConfirmDialog>
  );
};
