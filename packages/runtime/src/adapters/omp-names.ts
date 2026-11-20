/**
 * @file The `omp` driver's tool names (RFC-026), shared by its decoder and its
 *   guard so nothing outside the adapter learns `omp`'s spelling. `omp`'s
 *   built-ins are lower case (`bash`, `read`); Ork's tools reach the model as
 *   host tools (`set_host_tools`) named `ork_<tool>`. Both map to the names a
 *   node's rules, `ork logs` and the other drivers use (`Bash`,
 *   `mcp__ork__<tool>`); a name that starts with `mcp__` is no tool Ork knows.
 */

import { toolId } from "../tools/tool.ts";

/** The built-ins Ork may offer an `omp` session, by Ork's name for each. */
export const OMP_TOOLS: Readonly<Record<string, string>> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
};

/** How the model sees Ork's tools: `ork_report` is Ork's `report`. */
export const OMP_HOST_PREFIX = "ork_";

/**
 * A tool's name in Ork's words, or `undefined` for one Ork does not know (the
 * guard refuses it; the decoder shows it as `omp` wrote it).
 */
export const ompToolName = (name: string): string | undefined => {
  // Own keys only: `constructor` is no tool.
  if (Object.hasOwn(OMP_TOOLS, name)) return OMP_TOOLS[name];
  return name.startsWith(OMP_HOST_PREFIX) &&
    name.length > OMP_HOST_PREFIX.length
    ? toolId(name.slice(OMP_HOST_PREFIX.length))
    : undefined;
};
