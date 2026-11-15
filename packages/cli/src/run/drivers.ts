/**
 * @file Which `--driver` values Ork takes: the agent drivers it knows, the list
 *   `--help` names, and why a value is refused (a retired id names its
 *   replacement). `ork run`, `resume`, `chat` and `feedback apply` share them.
 */

import { AGENT_DRIVERS, DRIVER_IDS } from "@krapht/ork-integrations";
import { type Driver, retiredDriverHint } from "@krapht/ork-schema";

export type { Driver };

/** The drivers, as `--driver`'s help lists them. */
export const DRIVER_CHOICES = DRIVER_IDS.join(", ");

export const isDriver = (value: string): value is Driver =>
  AGENT_DRIVERS.some(d => d.id === value);

/** Why `--driver` refuses a value: a retired id names its replacement. */
export const badDriver = (value: string): string =>
  `--${retiredDriverHint(value) ?? `driver must be one of ${AGENT_DRIVERS.map(d => d.id).join(", ")}, got \`${value}\``}`;
