/**
 * @file The new-version part of the API's contract (specs/cli/updates.md, the
 *   UI's banner and upgrade): what the server knows of versions, read from the
 *   same record as the CLI's notice; the plan `ork upgrade` would follow, asked
 *   of the registry now; running that plan, whose output is streamed; and the
 *   restart `ork ui` does onto the new install. Like the rest of the contract
 *   it imports only `zod`, so a browser bundle can use it.
 */

import { z } from "zod";

/** The one upgrade a server runs at a time, kept for the server's life. */
export type UpgradeJob = {
  id: string;
  state: "running" | "succeeded" | "failed";
  /** The version it installs. */
  latest: string;
  /** The installer's command, as run (no shell). */
  command: string[];
  startedAt: string;
  endedAt?: string;
  /** Its exit code, once it ended; 127 when the program couldn't start. */
  code?: number;
};

/** What `GET /api/version` and the overview stream's `version` say. */
export type VersionInfo = {
  /** The version this server runs. */
  current: string;
  /** The registry's latest version, as last recorded. */
  latest: string | null;
  /** A version newer than `current` that the record knows; null when off. */
  newer: string | null;
  /** When the registry was last asked. */
  checkedAt: string | null;
  /** The release notes of `newer`. */
  releaseNotes: string | null;
  /** Off by `ORK_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER` or `CI`. */
  check: { on: true } | { on: false; reason: string };
  /** `ORK_UPDATE_REGISTRY`, when it names a registry other than npm's. */
  registry: string | null;
  job: UpgradeJob | null;
};

/** How Ork was installed, as `ork upgrade` names it. */
export type InstallerRef = { id: string; label: string };

/** What an upgrade would do now, from the registry's answer. */
export type UpgradePlanView =
  | { kind: "unreachable" }
  | { kind: "latest"; current: string }
  | {
      kind: "command";
      /** Passed back to `upgrade`, which refuses when the plan changed. */
      planId: string;
      current: string;
      latest: string;
      releaseNotes: string;
      installer: InstallerRef;
      command: string[];
      /** The ids of runs still running on this machine. */
      running: string[];
    }
  | {
      kind: "advice";
      planId: string;
      current: string;
      latest: string;
      releaseNotes: string;
      /** Null when Ork couldn't tell how it was installed. */
      installer: InstallerRef | null;
      /** `ork upgrade`'s line. */
      text: string;
      /** The same, as words ending in a colon, values in backticks... */
      words: string;
      /** ...then each command to run, apart from them. */
      commands: string[];
      running: string[];
    };

export const UpgradeSchema = z.strictObject({
  /** The plan the person read; the server runs its own argv, never a sent one. */
  planId: z.string().min(1),
});

export const UPDATE_API = {
  version: { method: "GET", path: "/api/version" },
  upgradePlan: { method: "POST", path: "/api/upgrade/plan" },
  upgrade: { method: "POST", path: "/api/upgrade", body: UpgradeSchema },
  restart: { method: "POST", path: "/api/restart" },
} as const;

/** What each new-version route answers with, on success. */
export type UpdateResponses = {
  version: VersionInfo;
  upgradePlan: UpgradePlanView;
  upgrade: { job: UpgradeJob };
  /** The port it comes back on, and the pid of the server that is stopping. */
  restart: { port: number; pid: number };
};

/** One line of the package manager's output; `id:` is its seq. */
export type UpgradeOutput = {
  seq: number;
  stream: "stdout" | "stderr";
  text: string;
};

/** How the upgrade ended. */
export type UpgradeEnd = {
  state: "succeeded" | "failed";
  code: number;
  version: string;
};

/**
 * The upgrade's stream (`/api/upgrade/stream`): its kept output after
 * `Last-Event-ID` or `?after=`, then each new line, then `end`.
 */
export type UpgradeStreamEvents = {
  output: UpgradeOutput;
  end: UpgradeEnd;
};
