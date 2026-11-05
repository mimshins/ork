/**
 * @file A labeled text input, on Base UI's. Its description, if any, is read
 *   out with it. A required field says so in its label's words, not by color.
 */

import { Input } from "@base-ui/react/input";
import { useId } from "react";

import { CodeText } from "./code-text.tsx";
import { Unseen } from "./unseen.tsx";

import styles from "./field.module.css";

export type TextFieldProps = {
  label: string;
  /** More of the label's words, for a screen reader only. */
  unseen?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  /** When the user leaves the field, or presses Enter in a single line. */
  onCommit?: (() => void) | undefined;
  /** More than one line; Enter starts a new one. */
  multiline?: boolean;
  description?: string | undefined;
  required?: boolean;
  /** Numbers get the numeric keyboard and the browser's check. */
  type?: "text" | "number";
};

export const TextField = ({
  label,
  unseen,
  value,
  onChange,
  onCommit,
  multiline = false,
  description,
  required = false,
  type = "text",
}: TextFieldProps) => {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className={styles["field"]}>
      <label
        className={styles["label"]}
        htmlFor={id}
      >
        {label}
        {unseen === undefined ? null : <Unseen>{unseen}</Unseen>}
        {required ? " (required)" : ""}
      </label>
      <div className={styles["group"]}>
        <Input
          aria-describedby={
            description === undefined ? undefined : descriptionId
          }
          className={styles["input"]}
          id={id}
          onBlur={onCommit}
          onKeyDown={event => {
            if (event.key === "Enter" && !multiline) onCommit?.();
          }}
          onValueChange={next => {
            onChange(next);
          }}
          render={multiline ? <textarea rows={4} /> : undefined}
          required={required}
          type={multiline ? undefined : type}
          value={value}
        />
      </div>
      {description === undefined ? null : (
        <p
          className={styles["hint"]}
          id={descriptionId}
        >
          <CodeText text={description} />
        </p>
      )}
    </div>
  );
};
