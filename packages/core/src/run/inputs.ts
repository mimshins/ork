import type { Workflow } from "@krapht/ork-schema";

export type InputsResult =
  | { ok: true; inputs: Record<string, string | number | boolean> }
  | { ok: false; errors: string[] };

const coerce = (
  name: string,
  type: "string" | "number" | "boolean",
  raw: string,
): { value: string | number | boolean } | { error: string } => {
  if (type === "string") return { value: raw };
  if (type === "number") {
    const value = Number(raw);
    return raw.trim() === "" || Number.isNaN(value)
      ? { error: `input "${name}" must be a number, got "${raw}"` }
      : { value };
  }
  if (raw === "true" || raw === "false") return { value: raw === "true" };
  return { error: `input "${name}" must be true or false, got "${raw}"` };
};

/**
 * Checks `--input name=value` pairs against the workflow's inputs: unknown
 * names, missing required inputs, and types. Defaults fill the rest.
 */
export const resolveInputs = (
  workflow: Workflow,
  raw: Readonly<Record<string, string>>,
): InputsResult => {
  const declared = workflow.inputs ?? {};
  const errors: string[] = [];
  const inputs: Record<string, string | number | boolean> = {};

  for (const name of Object.keys(raw)) {
    if (declared[name] === undefined) {
      errors.push(`unknown input "${name}"`);
    }
  }
  for (const [name, def] of Object.entries(declared)) {
    const value = raw[name];
    if (value === undefined) {
      if (def.default !== undefined) inputs[name] = def.default;
      else if (def.required === true) {
        errors.push(`missing required input "${name}" (--input ${name}=…)`);
      }
      continue;
    }
    const result = coerce(name, def.type ?? "string", value);
    if ("error" in result) errors.push(result.error);
    else inputs[name] = result.value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, inputs };
};

/** Parses `name=value` strings, as given to `--input`. */
export const parseInputPairs = (
  pairs: readonly string[],
): { ok: true; raw: Record<string, string> } | { ok: false; error: string } => {
  const raw: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0)
      return { ok: false, error: `expected name=value, got "${pair}"` };
    raw[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return { ok: true, raw };
};
