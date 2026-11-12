/**
 * @file What sits under a follow-up's facts in the Follow-ups panel: the body
 *   (the session's words, untrusted: no HTML), the draft a person sends and the
 *   steps a person runs (Ork never sends or runs either), how to take an
 *   agent's change in a run, the note when it came due without a merge, a
 *   failed read, and its CLI twin.
 */

import type { FollowUpDetail } from "@krapht/ork-server/client";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconAlert } from "../components/icons.tsx";
import { TextWell } from "../components/text-well.tsx";
import { Fact } from "./followups-facts.tsx";
import { type FollowUpRow, short } from "./followups-model.ts";

import styles from "./followups.module.css";

export const Draft = ({
  row,
  detail,
  onPost,
  gh,
}: {
  row: FollowUpRow;
  detail: FollowUpDetail | null;
  onPost: () => void;
  gh: boolean;
}) => {
  const { draft } = row;
  if (draft === undefined) return null;
  const channel = draft.channel;
  const post = detail?.actions.post;
  // One reason at a time: the draft's first, since Ork can't fix it, then gh.
  const ghReason = "`gh` isn't signed in";
  // Core's status refusals read "it is <status>"; copying helps only a draft's.
  const statusRefusal = post?.ok === false && post.why.startsWith("it is ");
  const label = post?.ok === false ? `Post to GitHub…: ${post.why}` : null;
  return (
    <div className={styles["draft"]}>
      <h4 className={styles["heading"]}>Draft message</h4>
      <dl className={styles["facts"]}>
        <Fact name="To">{draft.to}</Fact>
        {channel === undefined ? null : <Fact name="Channel">{channel}</Fact>}
      </dl>
      <div className={styles["wellHead"]}>
        <span className={styles["wellCopy"]}>
          <CopyButton
            label="Copy message"
            text={draft.text}
          />
        </span>
      </div>
      <TextWell label="Message text">
        <p className={styles["preview"]}>{draft.text}</p>
      </TextWell>
      <p className={styles["note"]}>
        Ork never sends this. Copy it, send it yourself, then mark it sent.
      </p>
      {channel === "github" ? (
        <Button
          aria-label={
            label ?? (gh ? "Post to GitHub…" : `Post to GitHub…: ${ghReason}`)
          }
          cli={`ork follow-ups post ${short(row.id)}`}
          disabled={post?.ok !== true || !gh}
          focusableWhenDisabled
          onClick={onPost}
          tip={
            post?.ok === false
              ? `Can't post: ${post.why}.${statusRefusal ? "" : " Copy the message and post it yourself."}`
              : gh
                ? undefined
                : `${ghReason}. Run gh auth login in a terminal.`
          }
        >
          Post to GitHub…
        </Button>
      ) : (
        <p className={styles["note"]}>
          <CodeText
            text={`Ork can't send to \`${channel ?? "that channel"}\`. Copy the message and send it yourself.`}
          />
        </p>
      )}
    </div>
  );
};

export const Steps = ({ row }: { row: FollowUpRow }) =>
  row.steps === undefined ? null : (
    <div className={styles["section"]}>
      <p className={styles["note"]}>
        Ork never runs these. Run each yourself, then mark this done.
      </p>
      <ol className={styles["steps"]}>
        {row.steps.map((step, index) => (
          <li
            className={styles["step"]}
            // The steps have no ids: their order is their identity.
            // oxlint-disable-next-line react/no-array-index-key -- see above
            key={index}
          >
            <span>{step.text}</span>
            {step.command === undefined ? null : (
              <CopyCommand command={step.command} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );

export const TakeInRun = ({ row }: { row: FollowUpRow }) =>
  row.for === "agent" && row.kind === "change" ? (
    <>
      <p className={styles["note"]}>
        {row.takenBy === undefined
          ? "Done when a run that takes it publishes."
          : `Taken by run ${short(row.takenBy)}; done when it publishes.`}
      </p>
      <p className={styles["note"]}>Take it in a run:</p>
      <CopyCommand command={`ork run start --follow-ups ${short(row.id)}`} />
    </>
  ) : null;

export const ClosedNote = ({
  row,
  detail,
}: {
  row: FollowUpRow;
  detail: FollowUpDetail | null;
}) =>
  detail?.cause === "closed-unmerged" ? (
    <p className={styles["alert"]}>
      <span className={styles["lineIcon"]}>
        <IconAlert />
      </span>
      <span>
        <CodeText
          text={`\`${row.ref ?? "The ref"}\` was closed without merging, so this is due now. Check it still applies, then mark it done or drop it.`}
        />
      </span>
    </p>
  ) : null;
