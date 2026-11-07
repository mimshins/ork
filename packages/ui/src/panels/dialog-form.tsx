/**
 * @file The pieces the panels' dialogs share: a form that also sends on ⌘Enter
 *   or Ctrl+Enter (Enter in a text field is a new line), the reason it can't be
 *   sent yet, said as it changes and tied to the control it explains (the
 *   Worktrees panel's dialogs use it too, with its own look), and a refusal
 *   that stays in the dialog.
 */

import type { ReactNode } from "react";

import { CodeText } from "../components/code-text.tsx";

import own from "./dialog-form.module.css";
import styles from "./feedback.module.css";

/** What the send button takes as its keys. */
export const SEND_KEYS = "Meta+Enter Control+Enter";

export const DialogForm = ({
  onSend,
  children,
}: {
  onSend: () => void;
  children: ReactNode;
}) => (
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ⌘Enter from the fields inside
  <form
    className={styles["form"]}
    onKeyDown={event => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSend();
      }
    }}
    onSubmit={event => {
      event.preventDefault();
      onSend();
    }}
  >
    {children}
  </form>
);

/**
 * Always there, so the reason is heard as it changes; what it explains points
 * at its `id` (`aria-describedby`), so it's read with that control too.
 */
export const Reason = ({ why, id }: { why: string | null; id?: string }) => (
  <output
    className={own["reason"]}
    id={id}
  >
    <CodeText text={why ?? ""} />
  </output>
);

export const Refusal = ({ text }: { text: string | null }) =>
  text === null ? null : (
    <p
      className={styles["alert"]}
      role="alert"
    >
      <CodeText text={text} />
    </p>
  );
