/**
 * @file Remove…, the twin of `ork worktrees remove`: one dialog, two steps.
 *   Opening only reads the plan; the action removes what it shows, or, when
 *   that loses work, goes on to what's lost and an explicit, danger-styled
 *   confirm. The focus starts on Cancel; no key presses a removal. While it
 *   removes it can't be closed, since that would hide whether it went.
 */

import type {
  Client,
  RemovePlanAnswer,
  WorktreeRow,
  WorktreesProject,
} from "@krapht/ork-server/client";
import { type RefObject, useEffect, useId, useRef } from "react";

import { Button } from "../components/button.tsx";
import { Dialog, type FinalFocus } from "../components/dialog.tsx";
import { FailureSlot } from "../components/failure-slot.tsx";
import { Reason } from "./dialog-form.tsx";
import { Choice, Lost } from "./remove-steps.tsx";
import { onLost, planIn, type RemoveStep, useRemove } from "./use-remove.ts";
import {
  forceReason,
  removeAction,
  removeDescription,
  removeTitle,
} from "./worktrees-model.ts";

import styles from "./worktrees.module.css";

const CHANGED = "It changed since you read it. Read it again before removing.";

const failureOf = (step: RemoveStep, label: string): string | null => {
  if (step.step === "readFailed")
    return `Could not read its state: ${step.error}`;
  if (step.step === "removeFailed")
    return `Could not remove ${label}: ${step.error}`;
  return step.step === "choice" && step.changed ? CHANGED : null;
};

const blockedOf = (step: RemoveStep): string | null => {
  if (step.step === "reading") return "Reading its state…";
  if (step.step === "readFailed") {
    return "Its state couldn't be read; Try again reads it.";
  }
  return step.step === "choice" ? forceReason(step.plan) : null;
};

type BodyProps = {
  client: Client;
  row: WorktreeRow;
  project: WorktreesProject;
  target: { project: string; key: string };
  cancel: RefObject<HTMLButtonElement | null>;
  onBusy: (busy: boolean) => void;
  onRemoved: (plan: RemovePlanAnswer) => void;
  onOpenRun: () => void;
  onClose: () => void;
};

const RemoveBody = ({
  client,
  row,
  project,
  target,
  cancel,
  onBusy,
  onRemoved,
  onOpenRun,
  onClose,
}: BodyProps) => {
  const flow = useRemove(client, target, onRemoved);
  const { step } = flow;
  const reasonId = useId();
  const failureId = useId();
  const action = useRef<HTMLButtonElement>(null);
  const removing = step.step === "removing";
  const plan = planIn(step);
  const lost = onLost(step);
  const changed = step.step === "choice" && step.changed;
  useEffect(() => {
    onBusy(removing);
  }, [removing, onBusy]);
  /** Back from what's lost, or a plan that changed: the action takes it. */
  const wasLost = useRef(false);
  useEffect(() => {
    const back = wasLost.current && !lost;
    wasLost.current = lost;
    if (changed || back) action.current?.focus();
  }, [changed, lost]);
  const failure = failureOf(step, row.label);
  return (
    <>
      {lost && plan !== undefined ? (
        <Lost
          head={project.head ?? "the current branch"}
          plan={plan}
          row={row}
        />
      ) : (
        <Choice
          busy={removing}
          deleteBranch={flow.deleteBranch}
          onDeleteBranch={flow.setDeleteBranch}
          onOpenRun={onOpenRun}
          plan={plan}
          project={project}
          reading={step.step === "reading"}
          row={row}
        />
      )}
      <FailureSlot
        id={failureId}
        onTryAgain={changed ? undefined : flow.tryAgain}
        takeFocus={step.step === "removeFailed" ? "always" : "ifLost"}
        words={failure}
      />
      <Reason
        id={reasonId}
        why={blockedOf(step)}
      />
      <div className={styles["foot"]}>
        {lost ? (
          <Button
            disabled={removing}
            focusableWhenDisabled
            onClick={flow.back}
            variant="ghost"
          >
            Back
          </Button>
        ) : null}
        <Button
          disabled={removing}
          focusableWhenDisabled
          onClick={onClose}
          ref={cancel}
          variant="ghost"
        >
          Cancel
        </Button>
        {lost ? (
          <Button
            aria-describedby={failureId}
            disabled={step.step !== "lost"}
            focusableWhenDisabled
            onClick={flow.loseIt}
            variant="danger"
          >
            {removing ? "Removing…" : "Remove and lose this work"}
          </Button>
        ) : (
          <Button
            aria-describedby={`${reasonId} ${failureId}`}
            disabled={step.step !== "choice"}
            focusableWhenDisabled
            onClick={flow.goOn}
            ref={action}
            variant={plan?.force === true ? "default" : "primary"}
          >
            {removing
              ? "Removing…"
              : plan === undefined
                ? "Remove worktree"
                : removeAction(plan)}
          </Button>
        )}
      </div>
    </>
  );
};

export type RemoveDialogProps = {
  open: boolean;
  client: Client;
  row: WorktreeRow;
  project: WorktreesProject;
  target: { project: string; key: string };
  finalFocus: FinalFocus;
  onRemoved: (plan: RemovePlanAnswer) => void;
  onOpenRun: () => void;
  onClose: () => void;
};

export const RemoveDialog = ({
  open,
  client,
  row,
  project,
  target,
  finalFocus,
  onRemoved,
  onOpenRun,
  onClose,
}: RemoveDialogProps) => {
  const cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const close = (): void => {
    if (!busy.current) onClose();
  };
  return (
    <Dialog
      description={removeDescription(row, project.root)}
      finalFocus={finalFocus}
      initialFocus={cancel}
      onOpenChange={next => {
        if (!next) close();
      }}
      open={open}
      size="wide"
      title={removeTitle(row)}
    >
      <RemoveBody
        cancel={cancel}
        client={client}
        onBusy={next => {
          busy.current = next;
        }}
        onClose={close}
        onOpenRun={onOpenRun}
        onRemoved={onRemoved}
        project={project}
        row={row}
        target={target}
      />
    </Dialog>
  );
};
