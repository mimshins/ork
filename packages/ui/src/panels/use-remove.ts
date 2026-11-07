/**
 * @file Remove…'s steps: reading the plan (which only reads), the choice (also
 *   delete the branch, which reads it again), then, when removing loses work,
 *   what's lost, and the removal, which hands the plan's digest back so the
 *   server removes only what was shown. A plan that changed since is read again
 *   and shown; nothing is removed but by `remove`.
 */

import type { Client, RemovePlanAnswer } from "@krapht/ork-server/client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RemoveStep =
  /** `shown` is the plan before, while the box reads it again. */
  | { step: "reading"; shown?: RemovePlanAnswer }
  | { step: "readFailed"; error: string; shown?: RemovePlanAnswer }
  | { step: "choice"; plan: RemovePlanAnswer; changed: boolean }
  | { step: "lost"; plan: RemovePlanAnswer }
  | { step: "removing"; plan: RemovePlanAnswer; from: "choice" | "lost" }
  | {
      step: "removeFailed";
      plan: RemovePlanAnswer;
      from: "choice" | "lost";
      error: string;
    };

/** The plan a step has to show, if any. */
export const planIn = (step: RemoveStep): RemovePlanAnswer | undefined =>
  "plan" in step ? step.plan : step.shown;

/** Which of the two steps' bodies shows. */
export const onLost = (step: RemoveStep): boolean =>
  step.step === "lost" ||
  ((step.step === "removing" || step.step === "removeFailed") &&
    step.from === "lost");

export type RemoveTarget = { project: string; key: string };

export const useRemove = (
  client: Client,
  target: RemoveTarget,
  onRemoved: (plan: RemovePlanAnswer) => void,
) => {
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [step, setStep] = useState<RemoveStep>({ step: "reading" });
  const newest = useRef(0);

  const fetchPlan = useCallback(
    async (branch: boolean) => {
      newest.current += 1;
      const mine = newest.current;
      const answer = await client.call("worktreeRemovePlan", {
        body: { ...target, deleteBranch: branch },
      });
      return mine === newest.current ? answer : null;
    },
    [client, target],
  );

  /** Shows the plan once it's read; only the newest read's answer. */
  const settle = useCallback(
    async (branch: boolean, shown?: RemovePlanAnswer): Promise<void> => {
      newest.current += 1;
      const mine = newest.current;
      const answer = await client.call("worktreeRemovePlan", {
        body: { ...target, deleteBranch: branch },
      });
      if (mine !== newest.current) return;
      setStep(
        answer.ok
          ? { step: "choice", plan: answer.data, changed: false }
          : {
              step: "readFailed",
              error: answer.error,
              ...(shown === undefined ? {} : { shown }),
            },
      );
    },
    [client, target],
  );

  // It opens reading, so the first read needs no step of its own.
  useEffect(() => {
    void settle(false);
  }, [settle]);

  const read = (branch: boolean, shown?: RemovePlanAnswer): void => {
    setStep(
      shown === undefined ? { step: "reading" } : { step: "reading", shown },
    );
    void settle(branch, shown);
  };

  const remove = async (
    plan: RemovePlanAnswer,
    from: "choice" | "lost",
  ): Promise<void> => {
    setStep({ step: "removing", plan, from });
    const answer = await client.call("worktreeRemove", {
      body: { ...target, deleteBranch, force: plan.force, digest: plan.digest },
    });
    if (answer.ok) {
      onRemoved(plan);
      return;
    }
    if (answer.status !== 409) {
      setStep({ step: "removeFailed", plan, from, error: answer.error });
      return;
    }
    // Refused before removing anything: read what it would do now.
    const again = await fetchPlan(deleteBranch);
    if (again === null) return;
    if (again.ok && again.data.digest !== plan.digest) {
      setStep({ step: "choice", plan: again.data, changed: true });
    } else {
      setStep({ step: "removeFailed", plan, from, error: answer.error });
    }
  };

  return {
    step,
    deleteBranch,
    setDeleteBranch: (next: boolean): void => {
      setDeleteBranch(next);
      read(next, planIn(step));
    },
    goOn: (): void => {
      if (step.step === "choice" && step.plan.force) {
        setStep({ step: "lost", plan: step.plan });
      } else if (step.step === "choice") {
        void remove(step.plan, "choice");
      }
    },
    back: (): void => {
      if (step.step === "lost") {
        setStep({ step: "choice", plan: step.plan, changed: false });
      }
    },
    loseIt: (): void => {
      if (step.step === "lost") void remove(step.plan, "lost");
    },
    tryAgain: (): void => {
      if (step.step === "removeFailed") void remove(step.plan, step.from);
      else read(deleteBranch, planIn(step));
    },
  };
};

export type RemoveFlow = ReturnType<typeof useRemove>;
