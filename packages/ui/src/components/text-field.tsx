/**
 * @file A labeled text input, on Base UI's. Its description, if any, is read
 *   out with it. A required field says so in its label's words, not by color.
 */

import { Input } from "@base-ui/react/input";
import { useId } from "react";

import styles from "./field.module.css";

export type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string | undefined;
  required?: boolean;
  /** Numbers get the numeric keyboard and the browser's check. */
  type?: "text" | "number";
};

export const TextField = ({
  label,
  value,
  onChange,
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
        {required ? " (required)" : ""}
      </label>
      <div className={styles["group"]}>
        <Input
          aria-describedby={
            description === undefined ? undefined : descriptionId
          }
          className={styles["input"]}
          id={id}
          onValueChange={next => {
            onChange(next);
          }}
          required={required}
          type={type}
          value={value}
        />
      </div>
      {description === undefined ? null : (
        <p
          className={styles["hint"]}
          id={descriptionId}
        >
          {description}
        </p>
      )}
    </div>
  );
};
