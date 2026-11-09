/**
 * @file The For each group of a node (RFC-013): whether it runs once or once
 *   per item, where the items come from, and how many run at once. A union of
 *   two objects the generated form could not tell apart, so it is drawn here;
 *   the list a node reads is a choice from the earlier nodes' declared lists,
 *   never a typed path.
 */

import { type ReactNode, useRef, useState } from "react";

import { CodeText } from "../components/code-text.tsx";
import { Select } from "../components/select.tsx";
import { DeclareList } from "./declare-field.tsx";
import {
  type EachKind,
  eachKindOf,
  holdersOf,
  type ItemShape,
  itemsSchemaOf,
  listField,
  listsBefore,
  wholeNumber,
  withEachKind,
} from "./for-each-model.ts";
import {
  CommitText,
  type FieldProps,
  Group,
  isRecord,
  Problems,
  setField,
} from "./form-parts.tsx";
import { Field } from "./schema-form.tsx";
import { descriptionOf } from "./schema-model.ts";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

const NOT_CHOSEN = "__not_chosen__";

const KINDS: readonly { value: EachKind; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "items", label: "Once per item, listed here" },
  { value: "from", label: "Once per item of a list from an earlier node" },
];

/** A whole number above 0 that commits when left; anything else says why. */
const CountField = ({
  field,
  label,
  description,
  required,
  bad,
  onBad,
}: {
  field: FieldProps;
  label: string;
  description: string | undefined;
  required: boolean;
  bad: boolean;
  onBad: (bad: boolean) => void;
}) => (
  <div className={styles["field"]}>
    <CommitText
      commit={typed => {
        const count = wholeNumber(typed);
        const empty = typed.trim() === "" && !required;
        onBad(count === undefined && !empty);
        if (count !== undefined || empty) setField(field, count);
      }}
      description={description}
      label={label}
      number
      required={required}
      shown={typeof field.value === "number" ? String(field.value) : ""}
    />
    {/* Always drawn, so a screen reader announces the line when it appears. */}
    <div role="alert">
      <Problems lines={bad ? [`${label} needs a whole number above 0.`] : []} />
    </div>
  </div>
);

/** The For each group at `nodes.<id>.forEach`. */
export const ForEachControl = ({
  builder,
  id,
  field,
}: {
  builder: Builder;
  id: string;
  field: FieldProps;
}) => {
  const graph = builder.view?.graph;
  const box = useRef<HTMLDivElement>(null);
  const [badMost, setBadMost] = useState(false);
  const [badAtOnce, setBadAtOnce] = useState(false);
  const kind = eachKindOf(field.value);
  // Once open it stays, so choosing Once doesn't close it under the select.
  const [opened, setOpened] = useState(kind !== "once");
  if (kind !== "once" && !opened) setOpened(true);
  if (graph === undefined) return null;
  const { value, context, path } = field;
  const own = isRecord(value) ? value : {};
  const from = typeof own["from"] === "string" ? own["from"] : "";
  const choices = listsBefore(graph, id);
  const chosen = choices.find(({ template }) => template === from);
  const holders = holdersOf(graph, builder.schema, id);
  const declare = async (
    node: string,
    name: string,
    shape: ItemShape,
  ): Promise<void> => {
    const type = holders.find(holder => holder.id === node)?.type ?? "";
    const template = `{{nodes.${node}.output.${listField(type, name)}}}`;
    await builder.edit(
      {
        op: "set",
        path: ["nodes", node, "output", "schema", name],
        value: { list: shape },
      },
      { op: "set", path: [...path, "from"], value: template },
    );
    // The first select is Run this node; the second is List from.
    box.current?.querySelectorAll<HTMLElement>("[role=combobox]")[1]?.focus();
  };
  const sub = (key: string): FieldProps => ({
    ...field,
    name: key,
    path: [...path, key],
    value: own[key],
  });
  return (
    <Group
      description={descriptionOf(field.schema)}
      name="forEach"
      open={opened}
    >
      <div
        className={styles["fields"]}
        ref={box}
      >
        <Select
          label="Run this node"
          onChange={next => {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one of the options
            setField(field, withEachKind(value, next as EachKind));
          }}
          options={KINDS}
          value={kind}
        />
        {kind === "once" ? null : (
          <p className={styles["hint"]}>
            <CodeText
              text={`Items are \`${id}.0\` to \`${id}.n\`. Their results gather into \`results\`, \`statuses\` and \`count\`.`}
            />
          </p>
        )}
        {kind === "items" ? (
          <Field
            {...sub("items")}
            required
            schema={itemsSchemaOf(field.schema)}
          />
        ) : null}
        {kind === "from" ? (
          <div className={styles["field"]}>
            <Select
              label="List from"
              onChange={next => {
                const found = choices.find(({ template }) => template === next);
                if (found !== undefined) {
                  context.change([...path, "from"], () => found.template);
                }
              }}
              options={[
                ...(from === ""
                  ? [{ value: NOT_CHOSEN, label: "Choose a list" }]
                  : []),
                ...(from === "" || chosen !== undefined
                  ? []
                  : [{ value: from, label: `${from} (not offered)` }]),
                ...choices.map(({ node, field: name, template }) => ({
                  value: template,
                  label: `${name} (from ${node})`,
                })),
              ]}
              value={from === "" ? NOT_CHOSEN : from}
            />
            <Problems lines={context.problems([...path, "from"])} />
            {chosen === undefined ? null : (
              <>
                <p className={styles["hint"]}>
                  <CodeText text={`Writes \`${chosen.template}\``} />
                </p>
                <p className={styles["hint"]}>
                  <CodeText
                    text={
                      chosen.items.length === 0
                        ? "Items have no declared fields."
                        : `Each item has ${chosen.items.map(item => `\`${item.field}\``).join(", ")}.`
                    }
                  />
                </p>
              </>
            )}
            {choices.length === 0 ? (
              <p className={styles["hint"]}>
                No earlier node declares a list. Add one below, or connect this
                node after one that does.
              </p>
            ) : null}
            <DeclareList
              holders={holders}
              onDeclare={(node, name, shape) => {
                void declare(node, name, shape);
              }}
              to={id}
            />
          </div>
        ) : null}
        {kind === "from" ? (
          <CountField
            bad={badMost}
            description="A longer list asks whether to stop, run this many, or run all."
            field={sub("maxItems")}
            label="Most items"
            onBad={setBadMost}
            required
          />
        ) : null}
        {kind === "once" ? null : (
          <>
            <CountField
              bad={badAtOnce}
              description="Default: the run's `limits.concurrency`."
              field={sub("maxParallel")}
              label="Most at once"
              onBad={setBadAtOnce}
              required={false}
            />
            <Select
              label="When an item fails"
              onChange={next => {
                context.change([...path, "onFailure"], () =>
                  next === "stop" ? "stop" : undefined,
                );
              }}
              options={[
                { value: "finish", label: "Run every item" },
                { value: "stop", label: "Start no more items" },
              ]}
              value={own["onFailure"] === "stop" ? "stop" : "finish"}
            />
          </>
        )}
      </div>
    </Group>
  );
};

/** The control for `nodes.<id>.forEach`, or `null` for any other field. */
export const forEachControl = (
  builder: Builder,
  id: string | null,
  field: FieldProps,
): ReactNode =>
  field.path.at(-1) === "forEach" && id !== null && field.path.length === 3 ? (
    <ForEachControl
      builder={builder}
      field={field}
      id={id}
    />
  ) : null;
