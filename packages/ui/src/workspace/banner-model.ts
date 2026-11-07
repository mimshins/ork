/**
 * @file Which new-version banner shows, if any (specs/ui/workspace.md): a page
 *   older than the server it talks to comes first, since its scripts can't be
 *   trusted; then the server's upgrade, running, installed or failed; then a
 *   newer version the record knows. None while the server can't be reached,
 *   with the check off, or for a day after it was dismissed for that version.
 *   What a banner that appears mid-session says aloud is here too.
 */

import type { VersionInfo } from "@krapht/ork-server/client";

import type { Connection } from "../state/app-state.ts";
import type { Preferences } from "../state/preferences.ts";

/** How long Dismiss hides it: the CLI's interval between notices. */
export const DISMISS_FOR_MS = 24 * 60 * 60 * 1000;

export type Banner =
  | { kind: "newer"; newer: string; current: string; releaseNotes: string }
  | { kind: "running"; latest: string }
  | { kind: "installed"; latest: string; current: string }
  | { kind: "failed"; latest: string; code: number }
  | { kind: "pageOlder"; page: string; server: string };

export type BannerInput = {
  info: VersionInfo | null;
  connection: Connection;
  /** The Ork version this page was built for, when known. */
  pageVersion: string | null;
  dismissed: Preferences["updateDismissed"];
  now: number;
};

const hidden = (
  dismissed: BannerInput["dismissed"],
  version: string,
  now: number,
): boolean =>
  dismissed?.version === version &&
  now - Date.parse(dismissed.at) < DISMISS_FOR_MS;

const fromJob = (
  info: VersionInfo,
  dismissed: BannerInput["dismissed"],
  now: number,
): Banner | null | undefined => {
  const { job } = info;
  if (job === null) return undefined;
  if (job.state === "running") return { kind: "running", latest: job.latest };
  if (hidden(dismissed, job.latest, now)) return null;
  return job.state === "succeeded"
    ? { kind: "installed", latest: job.latest, current: info.current }
    : { kind: "failed", latest: job.latest, code: job.code ?? 1 };
};

export const bannerOf = ({
  info,
  connection,
  pageVersion,
  dismissed,
  now,
}: BannerInput): Banner | null => {
  const { server } = connection;
  if (connection.link !== "open" || server === null || "error" in server) {
    return null;
  }
  if (pageVersion !== null && server.version !== pageVersion) {
    return { kind: "pageOlder", page: pageVersion, server: server.version };
  }
  if (info === null) return null;
  const job = fromJob(info, dismissed, now);
  if (job !== undefined) return job;
  const { newer, releaseNotes } = info;
  if (newer === null || releaseNotes === null) return null;
  return hidden(dismissed, newer, now)
    ? null
    : { kind: "newer", newer, current: info.current, releaseNotes };
};

/** What tells one banner from another, so each is said once. */
export const bannerKey = (banner: Banner | null): string =>
  banner === null
    ? "none"
    : `${banner.kind}:${"newer" in banner ? banner.newer : "latest" in banner ? banner.latest : banner.server}`;

/** What a banner says aloud when it appears while the page is open. */
export const arrivalWords = (banner: Banner | null): string | null => {
  if (banner?.kind === "newer") {
    return `Ork ${banner.newer} is out. Upgrade… is above the panels.`;
  }
  if (banner?.kind === "installed") {
    return `Ork ${banner.latest} is installed; restart \`ork ui\` to use it.`;
  }
  return banner?.kind === "pageOlder"
    ? `This page is from an older Ork. Reload to use ${banner.server}.`
    : null;
};

/** The version a banner's Dismiss hides, if it can be dismissed. */
export const dismissible = (banner: Banner): string | null => {
  if (banner.kind === "newer") return banner.newer;
  return banner.kind === "installed" || banner.kind === "failed"
    ? banner.latest
    : null;
};
