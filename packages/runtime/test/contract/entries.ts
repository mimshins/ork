/**
 * @file The contract suite's list: one entry per registered adapter, with the
 *   fake tool that stands in for its CLI and the capabilities its descriptor
 *   declares. A new driver adds its adapter in `registry.ts`, its fake under
 *   `test/fixtures/`, and one entry here; the suite then runs every case
 *   against it.
 */

import { fileURLToPath } from "node:url";

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
   * own).
   */
  fakeTool: string;
  capabilities: DriverCapabilities;
};

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
  },
  {
    driver: "command-code",
    adapter: commandCodeAdapter,
    fakeTool: fixture("fake-command.mjs"),
    capabilities: capabilitiesOf("command-code"),
  },
  {
    driver: "open-code",
    adapter: openCodeAdapter,
    fakeTool: fixture("fake-opencode.mjs"),
    capabilities: capabilitiesOf("open-code"),
  },
];
