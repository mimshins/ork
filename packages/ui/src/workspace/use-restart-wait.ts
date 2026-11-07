/**
 * @file The wait after Restart (specs/cli/updates.md): the page asks
 *   `/api/health` every second. Nothing, or the old server's pid, means it
 *   isn't back yet; a new pid on the upgraded version means it is, and the page
 *   says so and reloads; a new pid on another version means the `ork` that
 *   started isn't the upgraded one; 401 means this page isn't signed in to it.
 *   After a minute it gives up and says how to start it by hand.
 */

import type { Client } from "@krapht/ork-server/client";
import { useEffect, useRef } from "react";

import type { UpgradeStep } from "./use-upgrade.ts";

export type RestartTiming = {
  /** How often `/api/health` is asked. */
  pollMs: number;
  /** How long before giving up, and again after Keep waiting. */
  waitMs: number;
  /** How long "Reloading…" is shown before the reload. */
  reloadMs: number;
};

export const RESTART_TIMING: RestartTiming = {
  pollMs: 1000,
  waitMs: 60_000,
  reloadMs: 500,
};

type Restarting = Extract<UpgradeStep, { step: "restarting" }>;

/** What the health answer means for the wait, or null to keep waiting. */
const verdict = async (
  client: Client,
  waiting: Restarting,
  waitMs: number,
): Promise<UpgradeStep | null> => {
  const { job, port, pid, since } = waiting;
  const answer = await client.call("health");
  if (answer.ok && answer.data.pid !== pid) {
    const { version } = answer.data;
    return version === job.latest
      ? { step: "back", version }
      : { step: "oldVersion", job, version };
  }
  if (!answer.ok && answer.status === 401) return { step: "signedOut" };
  return Date.now() - since >= waitMs
    ? { step: "gaveUp", job, port, pid }
    : null;
};

export const useRestartWait = ({
  client,
  step,
  setStep,
  announce,
  reload,
  timing,
}: {
  client: Client;
  step: UpgradeStep;
  setStep: (step: UpgradeStep) => void;
  announce: (words: string) => void;
  reload: () => void;
  timing: RestartTiming;
}): void => {
  const told = useRef({ announce, reload });
  useEffect(() => {
    told.current = { announce, reload };
  });
  useEffect(() => {
    const waiting = step.step === "restarting" ? step : null;
    let stopped = false;
    const ask = async (from: Restarting): Promise<void> => {
      const next = await verdict(client, from, timing.waitMs);
      if (stopped || next === null) return;
      stopped = true;
      setStep(next);
      if (next.step !== "back") return;
      told.current.announce(`Ork ${next.version} is up. Reloading…`);
      setTimeout(() => {
        told.current.reload();
      }, timing.reloadMs);
    };
    const timer =
      waiting === null
        ? undefined
        : setInterval(() => {
            void ask(waiting);
          }, timing.pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client, step, setStep, timing]);
};
