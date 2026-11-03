/**
 * @file One open decision, shaped like the question tool: the question, its
 *   context, and its options with the recommended one standing out. An answer
 *   takes one click, or with the focus in the card a digit key, or `Enter` on
 *   the card itself for the recommended one. The answer comes back on the
 *   stream, so the card stays until the server says it is settled, and a
 *   refusal stays in it in the server's words.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";
import { type KeyboardEvent, useId, useState } from "react";

import { Kbd } from "../components/bits.tsx";
import { Button } from "../components/button.tsx";
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
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onOpenRun: (run: string, node: string) => void;
};

export const DecisionCard = ({
  decision,
  workflow,
  onAnswer,
  onOpenRun,
}: DecisionCardProps) => {
  const { id, runId, node, question, context, options, recommended } = decision;
  const questionId = useId();
  const fromId = useId();
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const answer = async (choice: Choice): Promise<void> => {
    if (sending) return;
    setSending(true);
    setRefusal(null);
    const done = await onAnswer(id, choice.id);
    setSending(false);
    if (!done.ok) setRefusal(done.error);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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
      <ul className={styles["options"]}>
        {options.map((choice, index) => {
          const isRecommended = choice.id === recommended;
          const command = answerCommand(decision, choice);
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
                      {isRecommended ? " (recommended)" : ""}
                    </span>
                    {choice.description === undefined ? null : (
                      <span className={styles["optionDescription"]}>
                        {choice.description}
                      </span>
                    )}
                  </span>
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
          Could not answer: {refusal}
        </p>
      )}
    </section>
  );
};
