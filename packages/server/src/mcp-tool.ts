/**
 * @file One of `ork mcp`'s tools (RFC-012): its name, what it says it does, its
 *   arguments as a Zod shape, whether it only reads, and its call, which checks
 *   the arguments before it runs.
 */

import { z } from "zod";

import { type McpAnswer, refused } from "./mcp-answers.ts";

export type McpTool = {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  /** Changes nothing: Claude Code is told so. */
  readOnly: boolean;
  call: (args: unknown) => Promise<McpAnswer>;
};

export const tool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  run: (args: z.infer<z.ZodObject<S>>) => McpAnswer | Promise<McpAnswer>,
  options: { readOnly?: boolean } = {},
): McpTool => {
  const schema = z.strictObject(shape);
  return {
    name,
    description,
    shape,
    readOnly: options.readOnly ?? true,
    call: args => {
      const parsed = schema.safeParse(args ?? {});
      return Promise.resolve(
        parsed.success
          ? run(parsed.data)
          : refused(z.prettifyError(parsed.error)),
      );
    },
  };
};
