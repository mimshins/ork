/**
 * @file The fields of a node or of the workflow itself. A change to one is an
 *   edit at its own path, so only that part of the file changes.
 */

import type { Diagnostic } from "@krapht/ork-server/client";

import { problemsAt, problemWords } from "./builder-model.ts";
import { customControl } from "./custom-controls.tsx";
import { type FormContext, type FormPath, isRecord } from "./form-parts.tsx";
import { Field } from "./schema-form.tsx";
import { type JsonSchema, kindOf } from "./schema-model.ts";
import type { Builder } from "./use-builder.ts";

export const contextFor = (
  builder: Builder,
  id: string | null,
  problems: readonly Diagnostic[],
): FormContext => ({
  custom: field => customControl(builder, id, field),
  change: (path, next) => {
    void builder.change(path, next);
  },
  problems: path =>
    problemsAt(problems, path).map(problem => problemWords(problem)),
});

export const TopFields = ({
  schema,
  value,
  path,
  hide,
  context,
}: {
  schema: JsonSchema;
  value: unknown;
  path: FormPath;
  hide: readonly string[];
  context: FormContext;
}) => {
  const kind = kindOf(schema);
  if (kind.kind !== "object") return null;
  const own = isRecord(value) ? value : {};
  return (
    <>
      {kind.fields
        .filter(({ key }) => !hide.includes(key))
        .map(field => (
          <Field
            context={context}
            key={field.key}
            name={field.key}
            path={[...path, field.key]}
            required={field.required}
            schema={field.schema}
            value={own[field.key]}
          />
        ))}
    </>
  );
};
