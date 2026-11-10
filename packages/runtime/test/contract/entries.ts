/**
 * @file The contract suite's list: one entry per registered adapter, with the
 *   fake tool that stands in for its CLI and the capabilities its descriptor
 *   declares. A new driver adds its adapter in `registry.ts`, its fake under
 *   `test/fixtures/`, and one entry here; the suite then runs every case
 *   against it.
 */

import { fileURLToPath } from "node:url";

import type { EndKind } from "@krapht/ork-core";
import {
  AGENT_DRIVERS,
  type DriverCapabilities,
  type DriverId,
} from "@krapht/ork-integrations";

import {
  type CliAdapter,
  claudeCodeAdapter,
  commandCodeAdapter,
  openCodeAdapter,
} from "../../src/index.ts";

export type ContractEntry = {
  driver: DriverId;
  adapter: CliAdapter;
  /**
   * A stand-in for the tool's CLI. It honours `FAKE_ENDPOINT_FILE` (write the
   * URL of Ork's endpoint there) and `FAKE_SCENARIO`: unset (start, call Ork's
   * tools, report), `invalid-report`, `try-denied` (call `Bash`, refused when
   * the node denies it), `wait-message` (end with `got: <the message>`), `hang`
   * (start, then wait to be interrupted) and, where the driver has no
   * `reportSchema`, `report-tool` (call Ork's `report` tool with a report
   * outside the schema, then with one inside, and end with no report of its
   * own), and `end:<kind>` (end the way the tool says that cause).
   */
  fakeTool: string;
  capabilities: DriverCapabilities;
  /** The causes the tool itself reports, which its fake plays as `end:<kind>`. */
  ends: readonly EndKind[];
};

/** The causes every tool reports; a tool that caps spending adds its budget. */
export const TOOL_ENDS: readonly EndKind[] = [
  "turn_limit",
  "auth",
  "out_of_credits",
  "rate_limited",
  "provider_unavailable",
  "model_unavailable",
];

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/** What a driver's descriptor declares it can do. */
const capabilitiesOf = (driver: DriverId): DriverCapabilities => {
  const found = AGENT_DRIVERS.find(d => d.id === driver);
  if (found === undefined) throw new Error(`no descriptor for ${driver}`);
  return found.capabilities;
};

export const CONTRACT: readonly ContractEntry[] = [
  {
    driver: "claude-code",
    adapter: claudeCodeAdapter,
    fakeTool: fixture("fake-claude.mjs"),
    capabilities: capabilitiesOf("claude-code"),
    // `--max-budget-usd`: only Claude Code caps a session's spending itself.
    // `ork validate` refuses `budgetUsd` on Command Code (no dollars), and Ork
    // checks OpenCode's only before a session or a late turn, not within one.
    ends: [...TOOL_ENDS, "budget_limit"],
  },
  {
    driver: "command-code",
    adapter: commandCodeAdapter,
    fakeTool: fixture("fake-command.mjs"),
    capabilities: capabilitiesOf("command-code"),
    ends: TOOL_ENDS,
  },
  {
    driver: "open-code",
    adapter: openCodeAdapter,
    fakeTool: fixture("fake-opencode.mjs"),
    capabilities: capabilitiesOf("open-code"),
    ends: TOOL_ENDS,
  },
];
