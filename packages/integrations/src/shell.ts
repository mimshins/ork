/**
 * @file The shell integration: `tool.shell` nodes run any program the command
 *   names, with no shell in between and nothing to sign in to.
 */

import { defineIntegration } from "./integration.ts";

export const shell = defineIntegration({
  id: "shell",
  label: "Any program",
  program: null,
  options: {},
  args: () => [],
});
