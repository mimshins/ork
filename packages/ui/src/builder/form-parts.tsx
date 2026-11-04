/**
 * @file The pieces every generated form is made of: what a field is given, a
 *   text box that commits when it's left, so a run of typing is one edit, a
 *   choice, and a group that opens while it holds something.
 */

import { type ReactNode, useState } from "react";

import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import {
  type Choice,
  choiceKey,
  descriptionOf,
  type JsonSchema,
  labelOf,
} from "./schema-model.ts";

import styles from "./builder.module.css";

export type FormPath = readonly (string | number)[];

export type FormContext = {
  /** A control of the builder's own for this field, if it has one. */
  custom?: ((field: FieldProps) => ReactNode) | undefined;
  /** What the checks say of this path. */
  problems: (path: FormPath) => readonly string[];
  /**
   * Changes the value at this path from what it is when the change's turn
   * comes. `undefined` takes the key out of the file.
   */
  change: (path: FormPath, next: (current: unknown) => unknown) => void;
};

export type FieldProps = {
  name: string;
  path: FormPath;
  schema: JsonSchema;
  value: unknown;
  required: boolean;
  context: FormContext;
};

/** Sets this field to `value`, whatever it was. */
export const setField = (field: FieldProps, value: unknown): void => {
  field.context.change(field.path, () => value);
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A text box that holds what's typed until it's left. */
export const CommitText = ({
  label,
  unseen,
  shown,
  commit,
  description,
  required = false,
  multiline = false,
  number = false,
}: {
  label: string;
  unseen?: string | undefined;
  shown: string;
  commit: (typed: string) => void;
  description?: string | undefined;
  required?: boolean;
  multiline?: boolean;
  number?: boolean;
}) => {
  const [typed, setTyped] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const [sent, setSent] = useState<string | null>(null);
  // The file changed under it, by an undo or a rename: show what's there now.
  // The answer to what was just sent isn't that, and more may be typed since.
  if (seen !== shown) {
    setSeen(shown);
    setSent(null);
    if (shown !== sent) setTyped(shown);
  }
  return (
    <TextField
      description={description}
      label={label}
      unseen={unseen}
      multiline={multiline}
      onChange={setTyped}
      onCommit={() => {
        if (typed !== shown && typed !== sent) {
          setSent(typed);
          commit(typed);
        }
      }}
      required={required}
      type={number ? "number" : "text"}
      value={typed}
    />
  );
};

const NOT_SET = "__not_set__";

export const ChoiceField = ({
  options,
  ...field
}: FieldProps & { options: readonly Choice[] }) => {
  const { name, schema, value, required } = field;
  const items = [
    // A required choice still has to be made: showing the first as chosen
    // would say the file has it, and choosing it would do nothing.
    ...(required && value !== undefined
      ? []
      : [{ value: NOT_SET, label: required ? "Choose one" : "Default" }]),
    ...options.map(option => ({
      value: choiceKey(option.value),
      label: option.label,
    })),
  ];
  const description = descriptionOf(schema);
  return (
    <div className={styles["choice"]}>
      <Select
        label={labelOf(name)}
        onChange={next => {
          setField(
            field,
            next === NOT_SET
              ? undefined
              : options.find(option => choiceKey(option.value) === next)?.value,
          );
        }}
        options={items}
        value={value === undefined ? (items[0]?.value ?? "") : choiceKey(value)}
      />
      {description === undefined ? null : (
        <p className={styles["hint"]}>{description}</p>
      )}
    </div>
  );
};

/** A collapsible group, open while it holds something. */
export const Group = ({
  name,
  description,
  open,
  children,
}: {
  name: string;
  description?: string | undefined;
  open: boolean;
  children: ReactNode;
}) => (
  <details
    className={styles["group"]}
    open={open}
  >
    <summary className={styles["summary"]}>{labelOf(name)}</summary>
    {description === undefined ? null : (
      <p className={styles["hint"]}>{description}</p>
    )}
    <div className={styles["fields"]}>{children}</div>
  </details>
);
