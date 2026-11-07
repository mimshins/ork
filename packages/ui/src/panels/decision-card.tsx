/**
 * @file One open decision, shaped like the question tool: where it came from
 *   (and the leader that passed it on, ADR-063), the question, its context, an
 *   optional note to send with the answer, and its options with the recommended
 *   one standing out. An answer takes one click, or with the focus in the card
 *   a digit key, or `Enter` on the card itself for the recommended one; keys
 *   typed in the note stay in the note. The answer comes back on the stream, so
 *   the card stays until the server says it is settled, and a refusal stays in
 *   it in the server's words.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { type KeyboardEvent, useId, useState } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Kbd } from "../components/kbd.tsx";
import { TextField } from "../components/text-field.tsx";
import { cliDescription, Tip } from "../components/tip.tsx";
import {
  answerCommand,
  type Choice,
  choiceForKey,
  choiceLabel,
} from "./decisions-model.ts";

import styles from "./decisions.module.css";

export type DecisionCardProps = {
  decision: DecisionRecord;
  /** The workflow its run is of, if known. */
  workflow: string | undefined;
  onAnswer: (
    id: string,
    choose: string,
    note: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onOpenRun: (run: string, node: string) => void;
};

/** Whether a key went to a field the person types in, not to the card. */
const typedInField = (target: EventTarget): boolean =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

export const DecisionCard = ({
  decision,
  workflow,
  onAnswer,
  onOpenRun,
}: DecisionCardProps) => {
  const { id, runId, node, question, context, options, recommended, owner } =
    decision;
  const questionId = useId();
  const fromId = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const answer = async (choice: Choice): Promise<void> => {
    if (sending) return;
    setSending(true);
    setRefusal(null);
    const done = await onAnswer(id, choice.id, note);
    setSending(false);
    if (!done.ok) setRefusal(done.error);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
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
      aria-labelledby={`${questionId} ${fromId}`}
      className={styles["card"]}
      data-decision={id}
      onKeyDown={onKey}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Enter on the card takes the recommended option
      tabIndex={0}
    >
      <p className={styles["from"]}>
        <span id={fromId}>
          {workflow === undefined ? "" : `${workflow} · `}
          {runId} · {node}
          {owner === undefined ? "" : `, passed on by ${owner}`}
        </span>
        <Button
          onClick={() => {
            onOpenRun(runId, node);
          }}
          variant="ghost"
        >
          Open run
        </Button>
      </p>
      <h3
        className={styles["question"]}
        id={questionId}
      >
        {question}
      </h3>
      {context === undefined ? null : (
        <p className={styles["context"]}>{context}</p>
      )}
      <TextField
        description="It goes with the option you choose; a gate passes it on as its note."
        label="Note for the run (optional)"
        multiline
        onChange={setNote}
        rows={2}
        value={note}
      />
      {note.trim() === "" ? null : (
        <CopyCommand command={answerCommand(decision, undefined, note)} />
      )}
      <ul className={styles["options"]}>
        {options.map((choice, index) => {
          const isRecommended = choice.id === recommended;
          const command = answerCommand(decision, choice, note);
          const digit = index < 9 ? String(index + 1) : undefined;
          return (
            <li key={choice.id}>
              <Tip cli={command}>
                <button
                  {...cliDescription(command)}
                  aria-disabled={sending ? "true" : undefined}
                  aria-keyshortcuts={digit}
                  className={styles["option"]}
                  data-recommended={isRecommended ? "" : undefined}
                  onClick={() => {
                    void answer(choice);
                  }}
                  type="button"
                >
                  {digit === undefined ? null : <Kbd keys={[digit]} />}
                  <span className={styles["optionText"]}>
                    <span className={styles["optionLabel"]}>
                      {choiceLabel(choice)}
                    </span>
                    {choice.description === undefined ? null : (
                      <span className={styles["optionDescription"]}>
                        {choice.description}
                      </span>
                    )}
                  </span>
                  {isRecommended ? (
                    <span className={styles["optionMark"]}>recommended</span>
                  ) : null}
                </button>
              </Tip>
            </li>
          );
        })}
      </ul>
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
