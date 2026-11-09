/**
 * @file One open decision, shaped like the question tool: where it came from
 *   (and the leader that passed it on, ADR-063), the question and its context
 *   as Markdown that folds when long, a document to read apart from them, an
 *   optional note to send with the answer, and its options with the recommended
 *   one standing out. A permission's context is a code block with a copy
 *   button. An answer takes one click, or with the focus in the card a digit
 *   key, or `Enter` on the card itself for the recommended one; keys typed in
 *   the note stay in the note. The answer comes back on the stream, so the card
 *   stays until the server says it is settled, and a refusal stays in it in the
 *   server's words.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { type KeyboardEvent, useId, useState } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { DecisionAnswer } from "./decision-answer.tsx";
import { DecisionDocument } from "./decision-document.tsx";
import { DecisionText } from "./decision-text.tsx";
import { type Choice, choiceForKey } from "./decisions-model.ts";

import styles from "./decisions.module.css";

export type DecisionCardProps = {
  decision: DecisionRecord;
  /** The workflow its run is of, if known. */
  workflow: string | undefined;
  /** `ork ui` cannot be reached, so an answer cannot be sent. */
  unreachable?: boolean;
  onAnswer: (
    id: string,
    choose: string,
    note: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onOpenRun: (run: string, node: string) => void;
};

/**
 * Whether a key went to a field the person types in, or to a control that has
 * its own use for it (Show all, Read, copy, a filter), not to the card.
 */
const typedInField = (target: EventTarget): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLButtonElement && !("option" in target.dataset));

export const DecisionCard = ({
  decision,
  workflow,
  unreachable = false,
  onAnswer,
  onOpenRun,
}: DecisionCardProps) => {
  const { id, runId, node, document, options, recommended, owner } = decision;
  const firstId = useId();
  const fromId = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const answer = async (choice: Choice): Promise<void> => {
    if (sending || unreachable) return;
    setSending(true);
    setRefusal(null);
    const done = await onAnswer(id, choice.id, note);
    setSending(false);
    if (!done.ok) setRefusal(done.error);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    // The document dialog is a portal: its keys bubble here in React's tree
    // but its target is outside the card's DOM, and a digit there is no answer.
    if (
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
    ) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (typedInField(event.target)) return;
    const onCard = event.target === event.currentTarget;
    const choice =
      event.key === "Enter" && onCard
        ? options.find(option => option.id === recommended)
        : choiceForKey(options, event.key);
    if (choice === undefined) return;
    event.preventDefault();
    void answer(choice);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the card takes the digit keys
    <section
      aria-labelledby={`${fromId} ${firstId}`}
      className={styles["card"]}
      data-decision={id}
      onKeyDown={onKey}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enter on the card takes the recommended option
      tabIndex={0}
    >
      <div className={styles["from"]}>
        <h3
          className={styles["fromText"]}
          id={fromId}
        >
          {workflow === undefined ? "" : `${workflow} · `}
          {runId} · {node}
          {owner === undefined ? "" : `, passed on by ${owner}`}
        </h3>
        <Button
          onClick={() => {
            onOpenRun(runId, node);
          }}
          variant="ghost"
        >
          Open run
        </Button>
      </div>
      <DecisionText
        decision={decision}
        nameId={firstId}
      />
      {document === undefined ? null : (
        <DecisionDocument
          decision={decision}
          document={document}
        />
      )}
      <DecisionAnswer
        decision={decision}
        note={note}
        onChoose={choice => {
          void answer(choice);
        }}
        onNote={setNote}
        sending={sending}
        unreachable={unreachable}
      />
      {refusal === null ? null : (
        <p
          className={styles["refusal"]}
          role="alert"
        >
          Could not answer: <CodeText text={refusal} />
        </p>
      )}
    </section>
  );
};
