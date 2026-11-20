/**
 * @file The pieces every generated form is made of: what a field is given, a
 *   text box that commits when it's left, so a run of typing is one edit, a
 *   choice, and a group that opens while it holds something.
 */

import { type ReactNode, useId, useState } from "react";

import { CodeText } from "../components/code-text.tsx";
import { Select } from "../components/select.tsx";
import { GlyphFailed } from "../components/status-glyphs.tsx";
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
  /** A field's hint, as this node adds to it (RFC-013's `{{item}}`). */
  hint?:
    | ((path: FormPath, description: string | undefined) => string | undefined)
    | undefined;
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
  /**
   * The id of this field's `Problems` lines, set by `Field` only while it has
   * problems. A control draws it as `aria-describedby` and, being set, as
   * `aria-invalid` and `invalid`.
   */
  problemId?: string | undefined;
};

/** Sets this field to `value`, whatever it was. */
export const setField = (field: FieldProps, value: unknown): void => {
  field.context.change(field.path, () => value);
};

/** What a control the builder draws itself needs to be tied to its problem. */
export const problemProps = (
  field: Pick<FieldProps, "problemId">,
): { describedBy: string | undefined; invalid: boolean } => ({
  describedBy: field.problemId,
  invalid: field.problemId !== undefined,
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the checks say of a field, each with its icon and its words. */
export const Problems = ({
  lines,
  id,
}: {
  lines: readonly string[];
  /** What a control's `aria-describedby` points at to read the lines. */
  id?: string | undefined;
}) =>
  lines.length === 0 ? null : (
    <div
      className={styles["problemLines"]}
      id={id}
    >
      {lines.map(line => (
        <p
          className={styles["problem"]}
          key={line}
        >
          <span className={styles["problemIcon"]}>
            <GlyphFailed />
          </span>
          <span className={styles["problemWords"]}>
            <CodeText text={line} />
          </span>
        </p>
      ))}
    </div>
  );

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
  describedBy,
  invalid,
}: {
  label: string;
  unseen?: string | undefined;
  shown: string;
  commit: (typed: string) => void;
  description?: string | undefined;
  required?: boolean;
  multiline?: boolean;
  number?: boolean;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
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
      describedBy={describedBy}
      description={description}
      invalid={invalid}
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
  const { name, schema, value, required, problemId } = field;
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
  const hintId = useId();
  return (
    <div className={styles["choice"]}>
      <Select
        describedBy={
          [description === undefined ? undefined : hintId, problemId]
            .filter(Boolean)
            .join(" ") || undefined
        }
        invalid={problemId !== undefined}
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
        <p
          className={styles["hint"]}
          id={hintId}
        >
          <CodeText text={description} />
        </p>
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
      <p className={styles["hint"]}>
        <CodeText text={description} />
      </p>
    )}
    <div className={styles["fields"]}>{children}</div>
  </details>
);
