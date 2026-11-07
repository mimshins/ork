/**
 * @file The Upgrade dialog's steps (specs/cli/updates.md), as `ork upgrade`'s
 *   over the server's routes: asking the registry, which only reads; the plan
 *   (the installer's command, or advice with nothing to run); running it only
 *   when the person presses Upgrade, with the server's own command, its output
 *   read from the upgrade's stream; how it ended; and the restart, whose wait
 *   is use-restart-wait.ts's. A refusal because the plan changed shows the new
 *   plan; one because another tab's upgrade runs shows that one. A plan that
 *   arrives, and an upgrade that finished, are said in the live region too, as
 *   a backstop for the heading or the button that changed.
 */

import {
  type Client,
  STREAMS,
  type UpgradeJob,
  type UpgradeOutput,
  type UpgradePlanView,
  type UpgradeStreamEvents,
} from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type OpenSource,
  openLink,
  type StreamLink,
} from "../state/stream-link.ts";

/** A plan with something to do: a command to run, or advice. */
export type ActionPlan = Extract<
  UpgradePlanView,
  { kind: "command" | "advice" }
>;

export type UpgradeStep =
  | { step: "checking" }
  | { step: "unreachable"; words: string }
  | { step: "latest"; current: string }
  | {
      step: "plan";
      plan: ActionPlan;
      refusal: string | null;
      starting: boolean;
    }
  | { step: "running"; job: UpgradeJob }
  | { step: "done"; job: UpgradeJob; refusal: string | null; asking: boolean }
  | { step: "failed"; job: UpgradeJob }
  | {
      step: "restarting";
      job: UpgradeJob;
      port: number;
      pid: number;
      since: number;
    }
  | { step: "back"; version: string }
  | { step: "gaveUp"; job: UpgradeJob; port: number; pid: number }
  | { step: "oldVersion"; job: UpgradeJob; version: string }
  | { step: "signedOut" };

/** Why the registry wasn't asked, naming the one it tried, as Asking does. */
export const unreachableWords = (registry: string | null): string =>
  registry === null
    ? "Could not reach the npm registry to look for a new version."
    : `Could not reach the registry at \`${registry}\` to look for a new version.`;

/** What a plan's answer shows. */
const planStep = (
  plan: UpgradePlanView,
  registry: string | null,
): UpgradeStep => {
  if (plan.kind === "unreachable") {
    return { step: "unreachable", words: unreachableWords(registry) };
  }
  if (plan.kind === "latest") return { step: "latest", current: plan.current };
  return { step: "plan", plan, refusal: null, starting: false };
};

/** What is said when a plan arrives: the button below changed with it. */
export const arrivedWords = (plan: ActionPlan): string =>
  plan.kind === "command"
    ? `Ork ${plan.latest} is out. The plan is below.`
    : `Ork ${plan.latest} is out. Ork can't run this upgrade from here; what to do is below.`;

/** The step a job is at: running, or how it ended. */
export const jobStep = (job: UpgradeJob): UpgradeStep => {
  if (job.state === "running") return { step: "running", job };
  return job.state === "succeeded"
    ? { step: "done", job, refusal: null, asking: false }
    : { step: "failed", job };
};

export type UpgradeOptions = {
  client: Client;
  open: OpenSource;
  /** The server's upgrade, when the dialog opens on it; else it asks anew. */
  job: UpgradeJob | null;
  /** `ORK_UPDATE_REGISTRY`'s registry, or null for npm's. */
  registry: string | null;
  announce: (words: string) => void;
  /** The plan recorded what the registry said: read the versions again. */
  onAsked: () => void;
};

export const useUpgrade = ({
  client,
  open,
  job,
  registry,
  announce,
  onAsked,
}: UpgradeOptions) => {
  const [step, setStep] = useState<UpgradeStep>(() =>
    job === null ? { step: "checking" } : jobStep(job),
  );
  const [output, setOutput] = useState<readonly UpgradeOutput[]>([]);
  const [lost, setLost] = useState(false);
  const link = useRef<StreamLink | null>(null);
  const last = useRef(0);
  // Read when called, so new callbacks never start the dialog over.
  const told = useRef({ announce, onAsked, registry });
  useEffect(() => {
    told.current = { announce, onAsked, registry };
  });

  /** Reads a job's output, kept and then live, until it ends. */
  const follow = useCallback(
    (followed: UpgradeJob): void => {
      link.current?.close();
      last.current = 0;
      setOutput([]);
      const opened = openLink<UpgradeStreamEvents>({
        url: () => `${STREAMS.upgrade}?after=${String(last.current)}`,
        open,
        on: {
          output: line => {
            if (line.seq <= last.current) return;
            last.current = line.seq;
            setOutput(before => [...before, line]);
          },
          end: end => {
            opened.close();
            setLost(false);
            setStep(jobStep({ ...followed, state: end.state, code: end.code }));
            if (end.state === "succeeded") {
              told.current.announce(`Upgraded to ${followed.latest}.`);
            }
          },
        },
        onStatus: status => {
          setLost(status === "lost");
        },
      });
      link.current = opened;
    },
    [open],
  );

  const ask = useCallback(async (): Promise<void> => {
    setStep({ step: "checking" });
    const answer = await client.call("upgradePlan");
    told.current.onAsked();
    const next: UpgradeStep = answer.ok
      ? planStep(answer.data, told.current.registry)
      : { step: "unreachable", words: answer.error };
    setStep(next);
    if (next.step === "plan") told.current.announce(arrivedWords(next.plan));
  }, [client]);

  // Opening asks, or reads the job it opened on; closing stops reading.
  const opening = useRef(job);
  useEffect(() => {
    const first = opening.current;
    if (first === null) void ask();
    else follow(first);
    return () => {
      link.current?.close();
    };
  }, [ask, follow]);

  /** Refused with 409: another tab's upgrade runs, or the plan changed. */
  const afterConflict = async (
    plan: ActionPlan,
    error: string,
  ): Promise<void> => {
    const version = await client.call("version");
    const running = version.ok ? version.data.job : null;
    if (running?.state === "running") {
      told.current.announce(error);
      setStep({ step: "running", job: running });
      follow(running);
      return;
    }
    const again = await client.call("upgradePlan");
    told.current.onAsked();
    if (!again.ok) {
      setStep({ step: "plan", plan, refusal: error, starting: false });
      return;
    }
    const next = planStep(again.data, told.current.registry);
    setStep(next.step === "plan" ? { ...next, refusal: error } : next);
  };

  const upgrade = async (plan: ActionPlan): Promise<void> => {
    setStep({ step: "plan", plan, refusal: null, starting: true });
    const answer = await client.call("upgrade", {
      body: { planId: plan.planId },
    });
    if (answer.ok) {
      told.current.announce(`Upgrading Ork to ${plan.latest}.`);
      setStep({ step: "running", job: answer.data.job });
      follow(answer.data.job);
    } else if (answer.status === 409) {
      await afterConflict(plan, answer.error);
    } else {
      setStep({ step: "plan", plan, refusal: answer.error, starting: false });
    }
  };

  const restart = async (ended: UpgradeJob): Promise<void> => {
    setStep({ step: "done", job: ended, refusal: null, asking: true });
    const answer = await client.call("restart");
    setStep(
      answer.ok
        ? {
            step: "restarting",
            job: ended,
            port: answer.data.port,
            pid: answer.data.pid,
            since: Date.now(),
          }
        : { step: "done", job: ended, refusal: answer.error, asking: false },
    );
  };

  return {
    step,
    setStep,
    /** The output so far, as the well shows it. */
    text: output.map(line => line.text).join("\n"),
    /** The output's stream dropped while the command may still run. */
    lost,
    ask: (): void => {
      void ask();
    },
    upgrade: (): void => {
      if (step.step === "plan" && step.plan.kind === "command") {
        void upgrade(step.plan);
      }
    },
    restart: (): void => {
      if (step.step === "done") void restart(step.job);
    },
    /** After giving up on the restart, another minute. */
    keepWaiting: (): void => {
      if (step.step === "gaveUp") {
        setStep({ ...step, step: "restarting", since: Date.now() });
      }
    },
  };
};
