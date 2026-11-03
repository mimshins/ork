/**
 * @file Writing to a node: `Enter` sends and `Shift+Enter` starts a new line.
 *   What was written stays until the server has taken it, and a refusal stays
 *   beside it in the server's words; the message itself comes back on the run's
 *   stream. When the run cannot be written to, this says why and gives the
 *   command.
 */

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { Button } from "../components/button.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { useAppState } from "../state/context.tsx";
import { chatCommand, whyNoSend } from "./chats-model.ts";
import type { RunView } from "./use-run-monitor.ts";

import fields from "../components/field.module.css";
import styles from "./chats.module.css";

export const ChatComposer = ({ run, node }: { run: RunView; node: string }) => {
  const state = useAppState();
  const id = useId();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const why = whyNoSend(run);
  const command = chatCommand(run.id, node);
  const typing = useRef(false);
  const ended = useRef<HTMLDivElement>(null);

  // The box goes with the run, and the focus must not go out of the panel.
  useEffect(() => {
    if (why !== null && typing.current) {
      typing.current = false;
      ended.current?.focus();
    }
  }, [why]);

  const send = async (): Promise<void> => {
    if (sending || body.trim() === "") return;
    setSending(true);
    setRefusal(null);
    const answer = await state.sendMessage(run.id, node, body);
    setSending(false);
    if (answer.ok) setBody("");
    else setRefusal(answer.error);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter while composing, as with an IME, picks a character.
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    void send();
  };

  if (why !== null) {
    return (
      <div
        className={styles["composer"]}
        ref={ended}
        tabIndex={-1}
      >
        <p className={styles["why"]}>{why}</p>
        {run.live === "paused" ? null : <CopyCommand command={command} />}
      </div>
    );
  }
  return (
    <form
      className={styles["composer"]}
      onSubmit={event => {
        event.preventDefault();
        void send();
      }}
    >
      <div className={styles["labelRow"]}>
        <label
          className={fields["label"]}
          htmlFor={id}
        >
          Message to {node}
        </label>
        <span className={styles["hint"]}>
          Enter sends, Shift+Enter starts a new line.
        </span>
      </div>
      <div className={styles["send"]}>
        <textarea
          className={styles["box"]}
          id={id}
          onBlur={() => {
            typing.current = false;
          }}
          onChange={event => {
            setBody(event.target.value);
          }}
          onFocus={() => {
            typing.current = true;
          }}
          onKeyDown={onKey}
          rows={1}
          value={body}
        />
        <Button
          cli={`${command} -m …`}
          disabled={sending || body.trim() === ""}
          focusableWhenDisabled
          type="submit"
          variant="primary"
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
      {refusal === null ? null : (
        <p
          className={styles["refusal"]}
          role="alert"
        >
          {refusal}
        </p>
      )}
    </form>
  );
};
