/**
 * @file The builder's own controls, where a generated one wouldn't know enough:
 *   an owner or a message's target comes from the nodes there are, and an agent
 *   or a skill from what the project offers.
 */

import type { ReactNode } from "react";

import { Combobox } from "../components/combobox.tsx";
import { Select } from "../components/select.tsx";
import { messageTargets } from "./builder-model.ts";
import { type FieldProps, isRecord, setField } from "./form-parts.tsx";
import { controlOf } from "./schema-form.tsx";
import { kindOf } from "./schema-model.ts";
import { SkillRows } from "./skill-rows.tsx";
import type { Builder } from "./use-builder.ts";

const NONE = "__none__";

/**
 * An input's default takes the type the input declares, so what's typed is
 * that: a string default of `1.10` stays a string. A value that isn't of that
 * type gets the free-form control, which shows it whatever it is.
 */
const inputDefault = (builder: Builder, field: FieldProps): ReactNode => {
  const { document } = builder.view ?? {};
  const inputs = isRecord(document) ? document["inputs"] : undefined;
  const input = isRecord(inputs) ? inputs[String(field.path[1])] : undefined;
  const type = isRecord(input) ? input["type"] : undefined;
  const declared = typeof type === "string" ? type : "string";
  return field.value === undefined || typeof field.value === declared
    ? controlOf({ ...field, schema: { ...field.schema, type: declared } })
    : null;
};

/** The control for this field, or `null` for a generated one. */
export const customControl = (
  builder: Builder,
  id: string | null,
  field: FieldProps,
): ReactNode => {
  const graph = builder.view?.graph;
  if (graph === undefined) return null;
  const last = field.path.at(-1);
  const text = typeof field.value === "string" ? field.value : undefined;
  if (last === "parent" && id !== null) {
    const others = graph.nodes
      .map(node => node.id)
      .filter(other => other !== id);
    return (
      <Select
        label="Owner"
        onChange={next => {
          setField(field, next === NONE ? undefined : next);
        }}
        options={[
          ...(field.required ? [] : [{ value: NONE, label: "None" }]),
          ...others.map(value => ({ value, label: value })),
        ]}
        value={text ?? NONE}
      />
    );
  }
  if (last === "to" && field.path.includes("notify")) {
    return (
      <Select
        label="To"
        onChange={next => {
          setField(field, next);
        }}
        options={messageTargets(graph).map(value => ({ value, label: value }))}
        value={text ?? ""}
      />
    );
  }
  if (last === "agent") {
    return (
      <Combobox
        empty="No agent matches."
        label="Agent"
        onChange={next => {
          setField(field, next ?? undefined);
        }}
        options={builder.catalog.agents.map(({ name, source }) => ({
          value: name,
          label: `${name} (${source})`,
        }))}
        placeholder="Type to find an agent"
        value={text ?? null}
      />
    );
  }
  if (last === "default" && field.path[0] === "inputs") {
    return inputDefault(builder, field);
  }
  // Only a plain list: `layers.project.skills` says something else entirely.
  if (last === "skills" && kindOf(field.schema).kind === "list") {
    return (
      <SkillRows
        catalog={builder.catalog}
        field={field}
      />
    );
  }
  return null;
};
