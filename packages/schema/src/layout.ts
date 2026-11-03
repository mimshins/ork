/**
 * @file The optional canvas file beside a workflow, `<name>.layout.json`: where
 *   its nodes sit, kept apart so a change of layout never shows in the
 *   workflow's own diff (ADR-006). A file that does not parse is treated as no
 *   file, since nothing about a run depends on it.
 */

import { z } from "zod";

export const LayoutFileSchema = z.object({
  nodes: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});

export type LayoutFile = z.infer<typeof LayoutFileSchema>;

/** The path of a workflow file's canvas file. */
export const layoutFileOf = (workflowFile: string): string =>
  workflowFile.replace(/\.ork\.ya?ml$/u, ".layout.json");

/** The positions in a canvas file's text; none if it is not a valid one. */
export const parseLayoutFile = (text: string): LayoutFile["nodes"] => {
  try {
    const parsed = LayoutFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.nodes : {};
  } catch {
    return {};
  }
};
