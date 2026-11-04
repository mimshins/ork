/**
 * @file What a `watch:` waits for (RFC-011), chosen as an edge's condition is,
 *   from what the node can say, so it can't wait for a value that never comes.
 */

import {
  type Condition,
  conditionText,
  type NodeSays,
} from "@krapht/ork-server/client";
import { useState } from "react";

import { Select } from "../components/select.tsx";
import { firstRow, saysOf, shownCondition } from "./condition-model.ts";
import { TestRows } from "./condition-picker.tsx";
import { DeclareField } from "./declare-field.tsx";
import { CommitText, type FieldProps, setField } from "./form-parts.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

const NAME = "stop looking";

export const UntilPicker = ({
  says,
  condition,
  until,
  onChange,
  onDeclare,
}: {
  says: NodeSays;
  condition: Condition | undefined;
  until: string | undefined;
  onChange: (until?: string) => void;
  onDeclare: (
    name: string,
    values: readonly (string | number | boolean)[],
  ) => void;
}) => {
  const [typing, setTyping] = useState(false);
  const shown = shownCondition({ condition, when: until }, says);
  const start = firstRow(says);
  const testing = !typing && shown.mode === "test";
  const unset = until === undefined && !typing;
  const mode = unset ? "unset" : testing ? "test" : "hand";
  return (
    <div className={styles["fields"]}>
      <Select
        label="Look until"
        onChange={next => {
          setTyping(next === "hand");
          if (next === "test" && start !== undefined) {
            onChange(
              conditionText({ mode: "test", join: "all", rows: [start] }),
            );
          }
        }}
        options={[
          ...(unset ? [{ value: "unset", label: "Choose one" }] : []),
          ...(start === undefined
            ? []
            : [{ value: "test", label: "A test holds" }]),
          { value: "hand", label: "Written by hand" },
        ]}
        value={mode}
      />
      {testing ? (
        <TestRows
          condition={shown}
          onChange={next => {
            onChange(conditionText(next));
          }}
          says={says}
          to={NAME}
        />
      ) : null}
      {mode === "hand" ? (
        <CommitText
          commit={typed => {
            onChange(typed === "" ? undefined : typed);
          }}
          description="An expression, such as json.state != 'pending'. It's kept as you write it."
          label="Condition"
          shown={until ?? ""}
          unseen={`, to ${NAME}`}
        />
      ) : null}
      {says.canDeclare ? (
        <DeclareField
          onDeclare={onDeclare}
          to={NAME}
        />
      ) : null}
    </div>
  );
};

/** The control for a node's `watch.until`. */
export const UntilControl = ({
  builder,
  id,
  field,
}: {
  builder: Builder;
  id: string;
  field: FieldProps;
}) => {
  const graph = builder.view?.graph;
  if (graph === undefined) return null;
  return (
    <UntilPicker
      condition={graph.untils?.[id]}
      onChange={next => {
        setField(field, next);
      }}
      onDeclare={(name, values) => {
        const [first] = values;
        void builder.edit(
          {
            op: "set",
            path: ["nodes", id, "output", "schema", name],
            value: values,
          },
          {
            op: "set",
            path: ["nodes", id, "watch", "until"],
            value: `json.${name} == ${JSON.stringify(first)}`,
          },
        );
      }}
      says={saysOf(graph, id)}
      until={typeof field.value === "string" ? field.value : undefined}
    />
  );
};
