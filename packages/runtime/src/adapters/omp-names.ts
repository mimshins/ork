/**
 * @file The `omp` driver's tool names (RFC-026), shared by its decoder and its
 *   guard so nothing outside the adapter learns `omp`'s spelling. `omp`'s
 *   built-ins are lower case (`bash`, `read`); Ork's tools reach the model
 *   through the session's plugin (`ork-session`) and its server (`ork`), as
 *   `mcp__ork_session_ork_<tool>` with the underscores kept. Both map to the
 *   names a node's rules, `ork logs` and the other drivers use (`Bash`,
 *   `mcp__ork__<tool>`).
 */

import { ORK_SERVER, toolId } from "../tools/tool.ts";

/** The built-ins Ork may offer an `omp` session, by Ork's name for each. */
export const OMP_TOOLS: Readonly<Record<string, string>> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
};

/** The name of the plugin folder that carries Ork's MCP server. */
export const OMP_PLUGIN = "ork-session";

/** How `omp` prefixes the tools of Ork's server in its plugin. */
export const OMP_ORK_PREFIX = `mcp__${OMP_PLUGIN.replaceAll("-", "_")}_${ORK_SERVER}_`;

/**
 * A tool's name in Ork's words, or `undefined` for one Ork does not know (the
 * guard refuses it; the decoder shows it as `omp` wrote it).
 */
export const ompToolName = (name: string): string | undefined => {
  // Own keys only: `constructor` is no tool.
  if (Object.hasOwn(OMP_TOOLS, name)) return OMP_TOOLS[name];
  return name.startsWith(OMP_ORK_PREFIX) && name.length > OMP_ORK_PREFIX.length
    ? toolId(name.slice(OMP_ORK_PREFIX.length))
    : undefined;
};
