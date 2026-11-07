/**
 * @file What an upgrade would do (ADR-038), shared by `ork upgrade` and the
 *   server behind `ork ui`: compares the registry's latest version with this
 *   one, works out how Ork was installed from the running script, and gives the
 *   installer's command (a global npm, pnpm, yarn, bun or Volta install) or
 *   advice (a clone, `npx`); and which runs are still running, whose next
 *   sessions would start from the new install.
 */

import { realpathSync } from "node:fs";

import type { EventStore } from "../store/types.ts";
import { liveStatus } from "../store/view.ts";
import { detectInstaller, type Installer } from "./installers.ts";
import { isNewer } from "./version.ts";

const REPOSITORY = "https://github.com/mimshins/ork";

/** The GitHub release page of a version, with its changes. */
export const releaseNotes = (name: string, version: string): string =>
  `${REPOSITORY}/releases/tag/${encodeURIComponent(`${name}@${version}`)}`;

export type UpgradePlan =
  | { kind: "unreachable" }
  | { kind: "latest" }
  | {
      kind: "command";
      latest: string;
      installer: Installer;
      argv: readonly string[];
    }
  | { kind: "advice"; latest: string; text: string };

/** The running script's real path, which tells how Ork was installed. */
export const runningScript = (): string => {
  const script = process.argv[1] ?? "";
  try {
    return realpathSync(script);
  } catch {
    return script;
  }
};

export const planUpgrade = (options: {
  name: string;
  current: string;
  /** The registry's latest version, `null` when it could not be asked. */
  latest: string | null;
  script: string;
  installers?: readonly Installer[];
}): UpgradePlan => {
  const { latest, name } = options;
  if (latest === null) return { kind: "unreachable" };
  if (!isNewer(latest, options.current)) return { kind: "latest" };
  const spec = `${name}@${latest}`;
  const installer = detectInstaller(options.script, options.installers);
  if (installer?.command !== undefined) {
    return {
      kind: "command",
      latest,
      installer,
      argv: installer.command(spec),
    };
  }
  const text =
    installer?.advice?.(spec, options.script.replaceAll("\\", "/")) ??
    `Ork could not tell how it was installed. With npm: npm install --global ${spec}`;
  return { kind: "advice", latest, text };
};

/** How many runs are looked at for the ones still running. */
const RUNS_LOOKED_AT = 500;

/** The ids of runs still running anywhere on this machine, newest first. */
export const runningRunIds = (store: EventStore): string[] =>
  store
    .runs({ limit: RUNS_LOOKED_AT })
    .filter(run => liveStatus(run) === "running")
    .map(run => run.id);
