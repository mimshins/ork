/**
 * @file What `ork upgrade` does (ADR-038): compares the registry's latest
 *   version with this one, works out how Ork was installed, and gives the
 *   command to run (a global npm, pnpm, yarn, bun or Volta install) or advice
 *   (a clone, `npx`); runs the command when the user agrees. Also the version
 *   line of `ork doctor`, read from the cache without asking the network.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

import {
  detectInstaller,
  type Installer,
  isNewer,
  newerVersion,
  type UpdateCache,
} from "@krapht/ork-core";
import type { CheckResult } from "@krapht/ork-integrations";

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

/** Runs the installer's command on this terminal; resolves its exit code. */
export const runInstall = (argv: readonly string[]): Promise<number> =>
  new Promise(resolve => {
    const [program = "", ...args] = argv;
    const child = spawn(program, args, { stdio: "inherit" });
    child.on("error", error => {
      process.stderr.write(`Could not run ${program}: ${error.message}\n`);
      resolve(127);
    });
    child.on("close", code => {
      resolve(code ?? 1);
    });
  });

/** `ork doctor`'s line for Ork itself, from the last check. */
export const versionCheck = (
  current: string,
  cache: UpdateCache | null,
  checksOff: boolean,
): CheckResult => {
  const newer = newerVersion(cache, current);
  if (newer !== null) {
    return {
      name: "ork",
      status: "warn",
      detail: `${current}; ${newer} is out`,
      hint: "Run ork upgrade.",
    };
  }
  const known =
    cache?.latest === undefined
      ? checksOff
        ? "update check off"
        : "not checked for updates yet"
      : `the latest as of ${cache.checkedAt.slice(0, 10)}`;
  return { name: "ork", status: "ok", detail: `${current} (${known})` };
};
