/**
 * @file The builder's own controls, where a generated one wouldn't know enough:
 *   an owner or a message's target comes from the nodes there are, and an agent
 *   or a skill from what the project offers.
 */

import type { ReactNode } from "react";

import { Combobox } from "../components/combobox.tsx";
import { Select } from "../components/select.tsx";
import { messageTargets } from "./builder-model.ts";
import { saysOf } from "./condition-model.ts";
import { type FieldProps, isRecord, setField } from "./form-parts.tsx";
import { controlOf } from "./schema-form.tsx";
import { skillsControl } from "./skill-rows.tsx";
import { UntilControl } from "./until-picker.tsx";
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
  // A join can't wait on more inputs than it has.
  if (last === "n" && id !== null && field.path.length === 3) {
    const inputs = graph.edges.filter(({ to }) => to === id).length;
    const current = typeof field.value === "number" ? field.value : 1;
    const counts = Array.from(
      { length: Math.max(inputs, current, 1) },
      (_, index) => String(index + 1),
    );
    return (
      <Select
        label="How many inputs to wait for"
        onChange={next => {
          setField(field, Number(next));
        }}
        options={counts.map(value => ({ value, label: value }))}
        value={String(current)}
      />
    );
  }
  // What a gate recommends, or takes on a timeout, is one of its options.
  if (
    (last === "recommended" || last === "default") &&
    id !== null &&
    field.path.length === 3
  ) {
    const says = saysOf(graph, id);
    const answers =
      says.fields.find(({ field: name }) => name === "choice")?.values ?? [];
    if (answers.length > 0) {
      return (
        <Select
          label={last === "default" ? "If it times out" : "Recommended"}
          onChange={next => {
            setField(field, next === NONE ? undefined : next);
          }}
          options={[
            { value: NONE, label: "None" },
            ...answers.map(value => ({
              value: String(value),
              label: String(value),
            })),
          ]}
          value={text ?? NONE}
        />
      );
    }
  }
  if (last === "until" && id !== null && field.path.includes("watch")) {
    return (
      <UntilControl
        builder={builder}
        field={field}
        id={id}
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
  if (last === "skills") return skillsControl(builder, field);
  return null;
};
