/**
 * @file The fields of a node or of the workflow itself. A change to one is an
 *   edit at its own path, so only that part of the file changes.
 */

import type { Diagnostic } from "@krapht/ork-server/client";

import { problemsAt, problemWords, readAt } from "./builder-model.ts";
import { customControl } from "./custom-controls.tsx";
import { forEachControl } from "./for-each-control.tsx";
import { itemHint } from "./for-each-model.ts";
import { type FormContext, type FormPath, isRecord } from "./form-parts.tsx";
import { isModelPath, modelClash, modelHint } from "./model-driver.ts";
import { Field } from "./schema-form.tsx";
import { type JsonSchema, kindOf } from "./schema-model.ts";
import type { Builder } from "./use-builder.ts";

export const contextFor = (
  builder: Builder,
  id: string | null,
  problems: readonly Diagnostic[],
): FormContext => ({
  custom: field =>
    forEachControl(builder, id, field) ?? customControl(builder, id, field),
  hint: (path, description) => {
    const graph = builder.view?.graph;
    const document = builder.view?.document;
    const nodes = isRecord(document) ? document["nodes"] : undefined;
    const node = isRecord(nodes) ? nodes[String(path[1])] : undefined;
    const hint =
      graph === undefined || !isRecord(node)
        ? description
        : itemHint(graph, path, node["forEach"], description);
    return isModelPath(path) && isRecord(node)
      ? modelHint(node["model"], hint)
      : hint;
  },
  change: (path, next) => {
    void builder.change(path, next);
  },
  problems: path => {
    const said = problemsAt(problems, path).map(problem =>
      problemWords(problem),
    );
    const document = builder.view?.document;
    // The server may already say it; one line is enough.
    const clash =
      isModelPath(path) && said.length === 0
        ? modelClash(
            readAt(document, path),
            readAt(document, [...path.slice(0, -1), "driver"]),
          )
        : undefined;
    return clash === undefined ? said : [...said, clash];
  },
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
