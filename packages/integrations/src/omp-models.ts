/**
 * @file What `omp models --json` says, for the `omp` driver's descriptor
 *   (`cli-drivers.ts`): the count of models its logins reach, as the doctor's
 *   login line, and the selector of each, for the model check before a run.
 */

import { field, parseJson } from "./json.ts";

/** `omp models --json`'s count of models: none is not signed in. */
export const ompModels = (stdout: string): string | null => {
  const models = field(parseJson(stdout), "models");
  if (!Array.isArray(models) || models.length === 0) return null;
  return `logged in (${models.length} model${models.length === 1 ? "" : "s"})`;
};

/**
 * The `selector` of each model `omp models --json` lists (an entry has
 * `provider`, `id` and `selector`), else `provider/id`; `null` when none.
 */
export const ompSelectors = (stdout: string): string[] | null => {
  const models = field(parseJson(stdout), "models");
  if (!Array.isArray(models)) return null;
  const selectors = models.flatMap(model => {
    const selector = field(model, "selector");
    if (typeof selector === "string" && selector !== "") return [selector];
    const provider = field(model, "provider");
    const id = field(model, "id");
    return typeof provider === "string" &&
      typeof id === "string" &&
      provider !== "" &&
      id !== ""
      ? [`${provider}/${id}`]
      : [];
  });
  return selectors.length === 0 ? null : selectors;
};
