/**
 * @file Clean merged…, the twin of `ork worktrees clean`: read then act, as
 *   Publish is. Opening reads each project's plan with the CLI's default filter
 *   (merged only, never forced); the focus starts on the first plan. The
 *   action, never the default, counts what it does and cleans exactly the plan
 *   shown. While it cleans it can't be closed; once done, the result takes its
 *   place.
 */

import type { CleanPlanProject, Client } from "@krapht/ork-server/client";
import { useEffect, useId, useRef } from "react";

import { Button } from "../components/button.tsx";
import {
  Dialog,
  DialogActions,
  type FinalFocus,
} from "../components/dialog.tsx";
import { FailureSlot } from "../components/failure-slot.tsx";
import {
  cleanAction,
  cleanDescription,
  cleanTitle,
  planned,
} from "./clean-model.ts";
import { BranchesBox, Cleaned, NoPlan, ProjectPlan } from "./clean-parts.tsx";
import { Reason } from "./dialog-form.tsx";
import { cleanPlanIn, type CleanStep, useClean } from "./use-clean.ts";

const failureOf = (step: CleanStep): string | null => {
  if (step.step === "readFailed") {
    return `Could not read the plan: ${step.error}`;
  }
  return step.step === "cleanFailed" ? `Could not clean: ${step.error}` : null;
};

/** Why the action can't be pressed now, if it can't. */
const blockedOf = (step: CleanStep): string | null => {
  if (step.step === "reading") return "Reading the plan…";
  return step.step === "readFailed"
    ? "The plan couldn't be read; Try again reads it."
    : null;
};

export type CleanDialogProps = {
  open: boolean;
  client: Client;
  /** The filter's project, or every project. */
  project: string | undefined;
  /**
   * The projects in scope with something merged, shown while the plan is read,
   * so the first well, where the focus starts, stays the same element.
   */
  scope: readonly CleanPlanProject[];
  finalFocus: FinalFocus;
  onCleaned: () => void;
  /** Closes it; `cleaned` says whether it cleaned. */
  onClose: (cleaned: boolean) => void;
};

export const CleanDialog = (props: CleanDialogProps) => {
  const flow = useClean(props.client, props.project, props.onCleaned);
  const { step } = flow;
  const well = useRef<HTMLElement>(null);
  const reasonId = useId();
  const failureId = useId();
  const cleaning = step.step === "cleaning";
  const reading = step.step === "reading";
  const plan = cleanPlanIn(step);
  const shown = plan === undefined ? props.scope : planned(plan.projects);
  const action = cleanAction(shown);
  const changed = step.step === "plan" && step.changed;
  const settled = plan !== undefined && !reading && action === null;
  const failed = step.step === "readFailed" && plan === undefined;
  useEffect(() => {
    if (changed) well.current?.focus();
  }, [changed]);
  // The well read in place of the plan goes once it's read: its first
  // project's well takes the focus, if the focus went with it.
  useEffect(() => {
    if (reading) return;
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      active.getAttribute("role") === "dialog";
    if (lost) well.current?.focus();
  }, [reading]);
  const close = (): void => {
    if (!cleaning) props.onClose(step.step === "done");
  };
  return (
    <Dialog
      description={cleanDescription(props.project !== undefined)}
      finalFocus={props.finalFocus}
      initialFocus={well}
      onOpenChange={next => {
        if (!next) close();
      }}
      open={props.open}
      size="wide"
      title={cleanTitle(shown.length === 0 ? props.scope : shown)}
    >
      {step.step === "done" ? (
        <>
          <Cleaned results={step.results} />
          <DialogActions>
            <Button onClick={close}>Close</Button>
          </DialogActions>
        </>
      ) : (
        <>
          {changed ? (
            <p role="alert">
              The plan changed since you read it. Read it again before cleaning.
            </p>
          ) : null}
          {shown.length === 0 ? (
            <NoPlan
              failed={failed}
              reading={reading}
              well={well}
            />
          ) : null}
          {shown.map((project, index) => (
            <ProjectPlan
              branches={flow.branches}
              failed={failed}
              key={project.root}
              project={project}
              reading={reading}
              well={index === 0 ? well : undefined}
            />
          ))}
          <BranchesBox
            checked={flow.branches}
            disabled={cleaning}
            onChange={flow.setBranches}
          />
          <FailureSlot
            id={failureId}
            onTryAgain={flow.tryAgain}
            takeFocus={step.step === "cleanFailed" ? "always" : "ifLost"}
            words={failureOf(step)}
          />
          <Reason
            id={reasonId}
            why={blockedOf(step)}
          />
          <DialogActions>
            <Button
              disabled={cleaning}
              focusableWhenDisabled
              onClick={close}
              variant="ghost"
            >
              {settled ? "Close" : "Cancel"}
            </Button>
            {settled ? null : (
              <Button
                aria-describedby={`${reasonId} ${failureId}`}
                disabled={step.step !== "plan"}
                focusableWhenDisabled
                onClick={flow.clean}
                variant="primary"
              >
                {cleaning ? "Removing…" : (action ?? "Remove worktrees")}
              </Button>
            )}
          </DialogActions>
        </>
      )}
    </Dialog>
  );
};
