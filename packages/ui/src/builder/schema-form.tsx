/**
 * @file A form generated from the workflow's JSON Schema (RFC-008), all the way
 *   down, so a person edits the whole format with no YAML: objects become
 *   groups, lists and named values become rows, and a union offers its kinds. A
 *   value no schema describes is typed as text, or as JSON for a list or
 *   number.
 */

import type { ReactNode } from "react";

import { CodeText } from "../components/code-text.tsx";
import { GlyphFailed } from "../components/status-glyphs.tsx";
import {
  ChoiceField,
  CommitText,
  type FieldProps,
  type FormContext,
  type FormPath,
  Group,
  isRecord,
  setField,
} from "./form-parts.tsx";
import { ListField, RecordField, VariantField } from "./form-rows.tsx";
import {
  descriptionOf,
  type FieldKind,
  isMultiline,
  kindOf,
  labelOf,
  readFree,
  showFree,
} from "./schema-model.ts";

import styles from "./builder.module.css";

const draw = (field: FieldProps): ReactNode => <Field {...field} />;

/** The fields of an object, each changing its own key. */
const ObjectFields = ({
  fields,
  value,
  path,
  context,
}: {
  fields: Extract<FieldKind, { kind: "object" }>["fields"];
  value: unknown;
  path: FormPath;
  context: FormContext;
}) => {
  const own = isRecord(value) ? value : {};
  return (
    <>
      {fields.map(({ key, schema, required }) => (
        <Field
          context={context}
          key={key}
          name={key}
          path={[...path, key]}
          required={required}
          schema={schema}
          value={own[key]}
        />
      ))}
    </>
  );
};

/** The generated control for this field. */
export const controlOf = (props: FieldProps): ReactNode => {
  const { name, path, schema, value, required, context } = props;
  const kind = kindOf(schema);
  const description = descriptionOf(schema);
  switch (kind.kind) {
    case "text":
      return (
        <CommitText
          commit={typed => {
            setField(props, typed === "" && !required ? undefined : typed);
          }}
          description={description}
          label={labelOf(name)}
          multiline={isMultiline(name, value)}
          required={required}
          shown={typeof value === "string" ? value : ""}
        />
      );
    case "number":
      return (
        <CommitText
          commit={typed => {
            setField(props, typed === "" ? undefined : Number(typed));
          }}
          description={description}
          label={labelOf(name)}
          number
          required={required}
          shown={typeof value === "number" ? String(value) : ""}
        />
      );
    case "choice":
      return (
        <ChoiceField
          {...props}
          options={kind.options}
        />
      );
    case "object":
      return (
        <Group
          description={description}
          name={name}
          open={isRecord(value) && Object.keys(value).length > 0}
        >
          <ObjectFields
            context={context}
            fields={kind.fields}
            path={path}
            value={value}
          />
        </Group>
      );
    case "list":
      return (
        <ListField
          {...props}
          draw={draw}
          fixed={kind.fixed}
          item={kind.item}
        />
      );
    case "record":
      return (
        <RecordField
          {...props}
          draw={draw}
          valueSchema={kind.value}
        />
      );
    case "variants":
      return (
        <VariantField
          {...props}
          draw={draw}
          variants={kind.variants}
        />
      );
    case "free":
      return (
        <CommitText
          commit={typed => {
            setField(props, readFree(typed));
          }}
          description={
            description ??
            'Text, or JSON for a number or a list. Quote text that looks like either, such as "5".'
          }
          label={labelOf(name)}
          multiline={typeof value === "string" && value.includes("\n")}
          shown={showFree(value)}
        />
      );
    default:
      return kind satisfies never;
  }
};

/** One value of any shape, with what the checks say of it. */
export const Field = (props: FieldProps) => {
  const { path, context } = props;
  const problems = context.problems(path);
  return (
    <div
      className={styles["field"]}
      data-problem={problems.length > 0 ? "" : undefined}
    >
      {context.custom?.(props) ?? controlOf(props)}
      {problems.map(problem => (
        <p
          className={styles["problem"]}
          key={problem}
        >
          <span className={styles["problemIcon"]}>
            <GlyphFailed />
          </span>
          <span className={styles["problemWords"]}>
            <CodeText text={problem} />
          </span>
        </p>
      ))}
    </div>
  );
};
