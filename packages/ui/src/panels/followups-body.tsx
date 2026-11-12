/**
 * @file What closes a follow-up in the Follow-ups panel: its body (the
 *   session's words, untrusted: no HTML, a link allow-list), a failed read of
 *   it, and its CLI twin.
 */

import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { FoldedText } from "../components/folded-text.tsx";
import { Markdown } from "../components/markdown.tsx";
import { type FollowUpRow, short } from "./followups-model.ts";

import styles from "./followups.module.css";

export const Body = ({ text }: { text: string }) =>
  text === "" ? null : (
    <FoldedText source={text}>
      <Markdown
        startLevel={4}
        text={text}
      />
    </FoldedText>
  );

export const ReadError = ({
  id,
  error,
}: {
  id: string;
  error: string | null;
}) =>
  error === null ? null : (
    <p
      className={styles["alert"]}
      role="alert"
    >
      <CodeText text={`Couldn't read ${id}: ${error}`} />
    </p>
  );

export const ShowTwin = ({ row }: { row: FollowUpRow }) => (
  <CopyCommand command={`ork follow-ups show ${short(row.id)}`} />
);
