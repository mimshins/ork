/**
 * @file What `ork doctor` says of Command Code leases (RFC-014): it removes the
 *   `ork` MCP entries a crashed session left in its checkout's local scope, and
 *   says where. Never prints a token.
 */

import { placeFiles, type ProjectPlace } from "@krapht/ork-core";
import type { CheckResult, Env } from "@krapht/ork-integrations";

/**
 * Removes the `ork` MCP entries a crashed Command Code session left in its
 * checkout's local scope (RFC-014), from the leases in the project's runs
 * folder. Says nothing when there were none. `bin` is the `cmd` program.
 */
export const leaseChecks = async (
  place: ProjectPlace,
  env: Env = process.env,
  bin = "cmd",
): Promise<CheckResult[]> => {
  const { cleanStaleLeases, leaseLedger } = await import("@krapht/ork-runtime");
  const { cleaned, failed } = await cleanStaleLeases({
    bin,
    ledger: leaseLedger(placeFiles(place).runs),
    env,
  });
  const name = "command-code";
  return [
    ...(cleaned.length === 0
      ? []
      : [
          {
            name,
            status: "ok" as const,
            detail: `removed the \`ork\` MCP entry a stopped session left in ${cleaned.join(", ")}`,
          },
        ]),
    ...(failed.length === 0
      ? []
      : [
          {
            name,
            status: "warn" as const,
            detail: `could not remove the \`ork\` MCP entry a stopped session left in ${failed.join(", ")}`,
            hint: "Run `cmd mcp remove --scope local ork` in each of those folders.",
          },
        ]),
  ];
};
