/**
 * @file `permission`: the `claude` CLI's `--permission-prompt-tool`, which
 *   sends each permission prompt to the run's `HumanChannel`. The SDK driver
 *   uses `canUseTool` instead.
 */

import { z } from "zod";

import { defineTool, text } from "./tool.ts";

export const permissionTool = defineTool({
  name: "permission",
  description: "Ork's permission prompt for the claude CLI.",
  shape: {
    tool_name: z.string(),
    input: z.record(z.string(), z.unknown()),
    tool_use_id: z.string().optional(),
  },
  // It is the prompt itself, named by --permission-prompt-tool.
  preapproved: false,
  available: ({ driver }) => driver === "cli",
  run: async ({ nodeId, ports }, args) => {
    const decision = await ports.human.permit({
      nodeId,
      toolName: args.tool_name,
      input: args.input,
    });
    return text(
      JSON.stringify(
        decision.allow
          ? { behavior: "allow", updatedInput: args.input }
          : { behavior: "deny", message: decision.message },
      ),
    );
  },
});
