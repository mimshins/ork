/**
 * @file An edge's condition as choices (RFC-010): when to follow it and, for a
 *   test, a field, a test and a value from what the node can say, so a value
 *   can't be mistyped wherever there's a list. What the choices can't say stays
 *   as its author wrote it.
 */

import {
  type Condition,
  type ConditionRow,
  type ConditionTest,
  conditionText,
  type NodeSays,
  type SaidField,
} from "@krapht/ork-server/client";
import { useState } from "react";

import { Button } from "../components/button.tsx";
import { Select } from "../components/select.tsx";
import { Unseen } from "../components/unseen.tsx";
import {
  comparable,
  firstRow,
  needsValue,
  rowFor,
  TEST_LABELS,
  testsFor,
} from "./condition-model.ts";
import { DeclareField } from "./declare-field.tsx";
import { CommitText } from "./form-parts.tsx";

import styles from "./builder.module.css";

type Mode = Condition["mode"];

export type PickerProps = {
  to: string;
  says: NodeSays;
  condition: Condition;
  /** The `when:` as written, for a condition typed by hand. */
  when: string | undefined;
  loop: boolean;
  gate: boolean;
  /** A router's last edge can be its otherwise. */
  canBeOtherwise: boolean;
  onChange: (when?: string) => void;
  /** Declares a field of this node, and reads it in this condition. */
  onDeclare: (
    name: string,
    values: readonly (string | number | boolean)[],
  ) => void;
};

const parsedValue = (typed: string, number: boolean): string | number =>
  number && typed.trim() !== "" && Number.isFinite(Number(typed))
    ? Number(typed)
    : typed;

const RowControls = ({
  row,
  fields,
  to,
  index,
  onChange,
}: {
  row: ConditionRow;
  fields: readonly SaidField[];
  to: string;
  index: number;
  onChange: (next: ConditionRow) => void;
}) => {
  const said = fields.find(({ field }) => field === row.field);
  const named = `${index === 0 ? "" : `${String(index + 1)} `}to ${to}`;
  if (said === undefined) return null;
  const values = said.values ?? [];
  return (
    <>
      <Select
        label="Field"
        unseen={`, ${named}`}
        onChange={next => {
          const field = fields.find(item => item.field === next);
          if (field !== undefined) onChange(rowFor(field));
        }}
        options={fields.map(({ field }) => ({ value: field, label: field }))}
        value={row.field}
      />
      <Select
        label="Test"
        unseen={`, ${named}`}
        onChange={next => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one of the options
          const test = next as ConditionTest;
          const { value } = rowFor(said);
          onChange({
            field: row.field,
            test,
            ...(needsValue(test) ? { value: row.value ?? value ?? "" } : {}),
          });
        }}
        options={testsFor(said).map(test => ({
          value: test,
          label: TEST_LABELS[test],
        }))}
        value={row.test}
      />
      {needsValue(row.test) && values.length > 0 ? (
        <Select
          label="Value"
          unseen={`, ${named}`}
          onChange={next => {
            onChange({
              ...row,
              value: values.find(value => String(value) === next) ?? next,
            });
          }}
          options={values.map(value => ({
            value: String(value),
            label: String(value),
          }))}
          value={String(row.value)}
        />
      ) : null}
      {needsValue(row.test) && values.length === 0 ? (
        <CommitText
          commit={typed => {
            onChange({
              ...row,
              value: parsedValue(typed, said.kind === "number"),
            });
          }}
          label="Value"
          unseen={`, ${named}`}
          number={said.kind === "number"}
          shown={String(row.value ?? "")}
        />
      ) : null}
    </>
  );
};

/** Rows have no identity of their own: each is where it is. */
const rowKey = (index: number): string => `row ${String(index)}`;

export const TestRows = ({
  condition,
  says,
  to,
  onChange,
}: {
  condition: Extract<Condition, { mode: "test" }>;
  says: NodeSays;
  to: string;
  onChange: (next: Condition) => void;
}) => {
  const { rows, join } = condition;
  const withRows = (next: readonly ConditionRow[]): void => {
    onChange({ mode: "test", join, rows: next });
  };
  const start = firstRow(says);
  return (
    <>
      {rows.length < 2 ? null : (
        <Select
          label="Which tests"
          unseen={`, to ${to}`}
          onChange={next => {
            onChange({
              mode: "test",
              join: next === "any" ? "any" : "all",
              rows,
            });
          }}
          options={[
            { value: "all", label: "All of these" },
            { value: "any", label: "Any of these" },
          ]}
          value={join}
        />
      )}
      {rows.map((row, index) => (
        <div
          className={styles["testRow"]}
          key={rowKey(index)}
        >
          <RowControls
            fields={comparable(says.fields)}
            index={index}
            onChange={next => {
              withRows(rows.map((old, at) => (at === index ? next : old)));
            }}
            row={row}
            to={to}
          />
          {rows.length < 2 ? null : (
            <Button
              onClick={() => {
                withRows(rows.filter((_, at) => at !== index));
              }}
            >
              Remove test {String(index + 1)}
              <Unseen>, to {to}</Unseen>
            </Button>
          )}
        </div>
      ))}
      {start === undefined ? null : (
        <Button
          onClick={() => {
            withRows([...rows, start]);
          }}
        >
          Add a test
          <Unseen>, to {to}</Unseen>
        </Button>
      )}
    </>
  );
};

export const ConditionPicker = ({
  to,
  says,
  condition,
  when,
  loop,
  gate,
  canBeOtherwise,
  onChange,
  onDeclare,
}: PickerProps) => {
  const [typing, setTyping] = useState(false);
  const start = firstRow(says);
  const mode: Mode = typing ? "hand" : condition.mode;
  const choose = (next: string): void => {
    setTyping(next === "hand");
    if (next === "hand") return;
    if (next === "fails") onChange("!ok");
    else if (next === "otherwise") onChange("true");
    else if (next === "succeeds") onChange();
    else if (start !== undefined) {
      onChange(conditionText({ mode: "test", join: "all", rows: [start] }));
    }
  };
  const options = [
    {
      value: "succeeds",
      label: loop
        ? "Every round"
        : gate
          ? "Whatever the answer"
          : "When it succeeds",
    },
    ...(says.canFail ? [{ value: "fails", label: "When it fails" }] : []),
    ...(start === undefined
      ? []
      : [{ value: "test", label: "When a test holds" }]),
    ...(canBeOtherwise ? [{ value: "otherwise", label: "Otherwise" }] : []),
    { value: "hand", label: "Written by hand" },
  ];
  return (
    <div className={styles["fields"]}>
      <Select
        label="Follow this edge"
        unseen={`, to ${to}`}
        onChange={choose}
        options={options}
        value={mode}
      />
      {mode === "test" && condition.mode === "test" ? (
        <TestRows
          condition={condition}
          onChange={next => {
            onChange(conditionText(next));
          }}
          says={says}
          to={to}
        />
      ) : null}
      {mode === "hand" ? (
        <CommitText
          commit={typed => {
            onChange(typed === "" ? undefined : typed);
          }}
          description="An expression, such as status == 'pass'. It's kept as you write it."
          label="Condition"
          unseen={`, to ${to}`}
          shown={when ?? ""}
        />
      ) : null}
      {says.canDeclare ? (
        <DeclareField
          onDeclare={onDeclare}
          to={to}
        />
      ) : null}
    </div>
  );
};
