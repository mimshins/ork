/**
 * @file What answers a decision: the note to send with the answer (and the CLI
 *   command that says the same), and the options, each with its digit key, the
 *   command that gives the same answer, and the recommended one standing out.
 *   An option is the one kind of button the card's keys treat as an answer
 *   (`data-option`); the card owns the key handling and the sending.
 */

import type { DecisionRecord } from "@krapht/ork-server/client";

import { CopyCommand } from "../components/copy-command.tsx";
import { Kbd } from "../components/kbd.tsx";
import { TextField } from "../components/text-field.tsx";
import { cliDescription, Tip } from "../components/tip.tsx";
import { answerCommand, type Choice, choiceLabel } from "./decisions-model.ts";

import styles from "./decisions.module.css";

export const DecisionAnswer = ({
  decision,
  note,
  onNote,
  sending,
  onChoose,
}: {
  decision: DecisionRecord;
  note: string;
  onNote: (note: string) => void;
  sending: boolean;
  onChoose: (choice: Choice) => void;
}) => (
  <>
    <TextField
      description="It goes with the option you choose; a gate passes it on as its note."
      label="Note for the run (optional)"
      multiline
      onChange={onNote}
      rows={2}
      value={note}
    />
    {note.trim() === "" ? null : (
      <CopyCommand command={answerCommand(decision, undefined, note)} />
    )}
    <ul className={styles["options"]}>
      {decision.options.map((choice, index) => {
        const isRecommended = choice.id === decision.recommended;
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
                data-option=""
                data-recommended={isRecommended ? "" : undefined}
                onClick={() => {
                  onChoose(choice);
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
  </>
);
