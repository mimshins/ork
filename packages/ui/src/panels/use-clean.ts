/**
 * @file Clean merged…'s steps: reading the plan (which only reads; "also delete
 *   the merged branches" reads it again), showing it, then cleaning exactly
 *   that, by handing its digest back. A plan that changed since is read again
 *   and shown; nothing is removed but by `clean`.
 */

import type {
  CleanDone,
  Client,
  WorktreesResponses,
} from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef, useState } from "react";

export type CleanPlan = WorktreesResponses["worktreesCleanPlan"];

export type CleanStep =
  | { step: "reading"; shown?: CleanPlan }
  | { step: "readFailed"; error: string; shown?: CleanPlan }
  | { step: "plan"; plan: CleanPlan; changed: boolean }
  | { step: "cleaning"; plan: CleanPlan }
  | { step: "cleanFailed"; plan: CleanPlan; error: string }
  | { step: "done"; results: CleanDone[] };

export const cleanPlanIn = (step: CleanStep): CleanPlan | undefined => {
  if (step.step === "done") return undefined;
  return "plan" in step ? step.plan : step.shown;
};

export const useClean = (
  client: Client,
  project: string | undefined,
  onCleaned: () => void,
) => {
  const [branches, setBranches] = useState(false);
  const [step, setStep] = useState<CleanStep>({ step: "reading" });
  const newest = useRef(0);

  const fetchPlan = useCallback(
    async (withBranches: boolean) => {
      newest.current += 1;
      const mine = newest.current;
      const answer = await client.call("worktreesCleanPlan", {
        body: {
          ...(project === undefined ? {} : { project }),
          branches: withBranches,
        },
      });
      return mine === newest.current ? answer : null;
    },
    [client, project],
  );

  /** Shows the plan once it's read; only the newest read's answer. */
  const settle = useCallback(
    async (withBranches: boolean, shown?: CleanPlan): Promise<void> => {
      newest.current += 1;
      const mine = newest.current;
      const answer = await client.call("worktreesCleanPlan", {
        body: {
          ...(project === undefined ? {} : { project }),
          branches: withBranches,
        },
      });
      if (mine !== newest.current) return;
      setStep(
        answer.ok
          ? { step: "plan", plan: answer.data, changed: false }
          : {
              step: "readFailed",
              error: answer.error,
              ...(shown === undefined ? {} : { shown }),
            },
      );
    },
    [client, project],
  );

  // It opens reading, so the first read needs no step of its own.
  useEffect(() => {
    void settle(false);
  }, [settle]);

  const read = (withBranches: boolean, shown?: CleanPlan): void => {
    setStep(
      shown === undefined ? { step: "reading" } : { step: "reading", shown },
    );
    void settle(withBranches, shown);
  };

  const clean = async (plan: CleanPlan): Promise<void> => {
    setStep({ step: "cleaning", plan });
    const answer = await client.call("worktreesClean", {
      body: {
        ...(project === undefined ? {} : { project }),
        branches,
        digest: plan.digest,
      },
    });
    if (answer.ok) {
      setStep({ step: "done", results: answer.data.projects });
      onCleaned();
      return;
    }
    if (answer.status !== 409) {
      setStep({ step: "cleanFailed", plan, error: answer.error });
      return;
    }
    const again = await fetchPlan(branches);
    if (again === null) return;
    if (again.ok && again.data.digest !== plan.digest) {
      setStep({ step: "plan", plan: again.data, changed: true });
    } else {
      setStep({ step: "cleanFailed", plan, error: answer.error });
    }
  };

  return {
    step,
    branches,
    setBranches: (next: boolean): void => {
      setBranches(next);
      read(next, cleanPlanIn(step));
    },
    clean: (): void => {
      if (step.step === "plan") void clean(step.plan);
    },
    tryAgain: (): void => {
      if (step.step === "cleanFailed") void clean(step.plan);
      else read(branches, cleanPlanIn(step));
    },
  };
};
