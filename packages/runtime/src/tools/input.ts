/**
 * @file `read_input`: what the workflow sent a node back with, whole. A loop's
 *   re-entry note shows the first 8 KiB of it; when that cut it, the session
 *   gets this tool and reads the rest a page at a time, so a long review's last
 *   findings reach the node.
 */

import { z } from "zod";

import { defineTool, text } from "./tool.ts";

/** The characters one call returns. */
export const INPUT_PAGE = 32_000;

export const readInputTool = defineTool({
  name: "read_input",
  description: `Read what the workflow sent your task back with, whole, when Ork's message cut it. Returns up to ${INPUT_PAGE.toLocaleString("en-US")} characters, from \`from\`.`,
  shape: {
    from: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("The character to start at. Default: 0."),
  },
  available: ({ ports }) => ports.input !== undefined,
  run: ({ ports }, args) => {
    const whole = ports.input ?? "";
    const from = Math.min(args.from ?? 0, whole.length);
    const end = Math.min(from + INPUT_PAGE, whole.length);
    const where =
      end < whole.length
        ? `[characters ${String(from)}–${String(end)} of ${String(whole.length)}; call read_input with from: ${String(end)} for the rest]`
        : `[characters ${String(from)}–${String(end)} of ${String(whole.length)}: the end]`;
    return Promise.resolve(text(`${whole.slice(from, end)}\n\n${where}`));
  },
});
