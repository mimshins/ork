/**
 * @file The generated form's rows: a list, named values, and a union that
 *   offers its kinds. Each holds other fields, which the form draws, so this
 *   file takes the drawing as a prop.
 */

import { type ReactNode, useState } from "react";

import { Button } from "../components/button.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import { type FieldProps, Group, isRecord, setField } from "./form-parts.tsx";
import {
  descriptionOf,
  emptyFor,
  type JsonSchema,
  labelOf,
  variantFor,
  variantWord,
} from "./schema-model.ts";

import styles from "./builder.module.css";

/** A change that takes the key out of the file. */
const takenOut = (): undefined => {};

type Draws = { draw: (field: FieldProps) => ReactNode };

const listOf = (current: unknown): readonly unknown[] =>
  Array.isArray(current) ? current : [];

export const ListField = ({
  name,
  path,
  schema,
  value,
  context,
  item,
  fixed,
  minRows = 0,
  draw,
}: FieldProps &
  Draws & {
    item: JsonSchema;
    fixed?: number | undefined;
    /** Rows that can't be removed: a list the format needs at least this long. */
    minRows?: number;
  }) => {
  const rows: readonly unknown[] = Array.isArray(value) ? value : [];
  return (
    <Group
      description={descriptionOf(schema)}
      name={name}
      open={rows.length > 0}
    >
      {rows.map((row, index) => (
        <div
          className={styles["row"]}
          // A row has no identity but its place.
          // oxlint-disable-next-line react/no-array-index-key -- see above
          key={index}
        >
          {draw({
            context,
            name: `${name} ${String(index + 1)}`,
            path: [...path, index],
            required: true,
            schema: item,
            value: row,
          })}
          {fixed === undefined && rows.length > minRows ? (
            <Button
              onClick={() => {
                context.change(path, current => {
                  const left = listOf(current).filter((_, at) => at !== index);
                  return left.length === 0 ? undefined : left;
                });
              }}
            >
              Remove {labelOf(name).toLowerCase()} {index + 1}
            </Button>
          ) : null}
        </div>
      ))}
      {fixed !== undefined && rows.length >= fixed ? null : (
        <Button
          onClick={() => {
            context.change(path, current => [
              ...listOf(current),
              emptyFor(item),
            ]);
          }}
        >
          Add to {labelOf(name).toLowerCase()}
        </Button>
      )}
    </Group>
  );
};

export const RecordField = ({
  name,
  path,
  schema,
  value,
  context,
  valueSchema,
  draw,
}: FieldProps & Draws & { valueSchema: JsonSchema }) => {
  const rows = isRecord(value) ? Object.entries(value) : [];
  const [adding, setAdding] = useState("");
  const newName = adding.trim();
  const taken = rows.some(([key]) => key === newName);
  return (
    <Group
      description={descriptionOf(schema)}
      name={name}
      open={rows.length > 0}
    >
      {rows.map(([key, row]) => (
        <div
          className={styles["row"]}
          key={key}
        >
          {draw({
            context,
            name: key,
            path: [...path, key],
            required: true,
            schema: valueSchema,
            value: row,
          })}
          <Button
            onClick={() => {
              context.change([...path, key], takenOut);
            }}
          >
            Remove {key}
          </Button>
        </div>
      ))}
      <TextField
        description={taken ? `${newName} is already here.` : undefined}
        label={`New name in ${labelOf(name).toLowerCase()}`}
        onChange={setAdding}
        value={adding}
      />
      <Button
        disabled={newName === "" || taken}
        focusableWhenDisabled
        onClick={() => {
          // A name that arrived meanwhile keeps its value.
          context.change([...path, newName], current =>
            current === undefined ? emptyFor(valueSchema) : current,
          );
          setAdding("");
        }}
      >
        Add to {labelOf(name).toLowerCase()}
      </Button>
    </Group>
  );
};

export const VariantField = (
  props: FieldProps & Draws & { variants: readonly JsonSchema[] },
) => {
  const { name, value, variants, draw } = props;
  const at = variantFor(variants, value);
  const chosen = variants[at] ?? {};
  return (
    <div className={styles["fields"]}>
      <Select
        label={`${labelOf(name)} as`}
        onChange={next => {
          setField(props, emptyFor(variants[Number(next)] ?? {}));
        }}
        options={variants.map((variant, index) => ({
          value: String(index),
          label: variantWord(variant),
        }))}
        value={String(at)}
      />
      {draw({ ...props, schema: chosen })}
    </div>
  );
};
