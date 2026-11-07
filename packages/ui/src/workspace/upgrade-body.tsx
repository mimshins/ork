/**
 * @file The Upgrade dialog's body: the steps' flow (use-upgrade.ts) and the
 *   restart's wait (use-restart-wait.ts), and the part each step shows: asking
 *   and the plan, the run and how it ended, or the restart's wait and how that
 *   ended. While it waits for the restart, the app knows, so the status bar's
 *   lost connection stays quiet.
 */

import { type RefObject, use, useCallback, useEffect } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "./context.ts";
import { AskBody, type AskStep } from "./upgrade-ask.tsx";
import { RestartBody, type RestartStep } from "./upgrade-restart.tsx";
import { RunBody, type RunStep } from "./upgrade-run.tsx";
import { type RestartTiming, useRestartWait } from "./use-restart-wait.ts";
import { type UpgradeStep, useUpgrade } from "./use-upgrade.ts";

export const isAsk = (step: UpgradeStep): step is AskStep =>
  ["checking", "unreachable", "latest", "plan"].includes(step.step);

const isRun = (step: UpgradeStep): step is RunStep =>
  ["running", "done", "failed"].includes(step.step);

const isRestart = (step: UpgradeStep): step is RestartStep =>
  !isAsk(step) && !isRun(step);

/** Where the focus can start: Cancel, the job's output, or how it ended. */
export type Starts = {
  first: RefObject<HTMLButtonElement | null>;
  output: RefObject<HTMLElement | null>;
  heading: RefObject<HTMLHeadingElement | null>;
};

type BodyProps = {
  starts: Starts;
  timing: RestartTiming;
  reload: () => void;
  onStep: (step: UpgradeStep) => void;
  onClose: () => void;
};

export const UpgradeBody = ({
  starts,
  timing,
  reload,
  onStep,
  onClose,
}: BodyProps) => {
  const { version, client } = useAppState();
  const workspace = use(WorkspaceContext);
  const info = useValue(version.info);
  const opening = useValue(version.dialog);
  const announce = useCallback(
    (words: string) => workspace?.announce(words),
    [workspace],
  );
  const flow = useUpgrade({
    client,
    open: version.open,
    job: opening === "job" ? (info?.job ?? null) : null,
    registry: info?.registry ?? null,
    announce,
    onAsked: () => void version.refresh(),
  });
  const { step, setStep } = flow;
  useRestartWait({ client, step, setStep, announce, reload, timing });
  useEffect(() => {
    onStep(step);
  }, [step, onStep]);
  // While it waits, the lost connection is expected; the dialog says so.
  const waiting = step.step === "restarting" || step.step === "back";
  useEffect(() => {
    void version.restarting.setValue(waiting);
    return () => {
      void version.restarting.setValue(false);
    };
  }, [version, waiting]);
  const port = window.location.port;
  if (isAsk(step)) {
    return (
      <AskBody
        first={starts.first}
        onAsk={flow.ask}
        onClose={onClose}
        onUpgrade={flow.upgrade}
        registry={info?.registry ?? null}
        step={step}
      />
    );
  }
  if (isRun(step)) {
    return (
      <RunBody
        current={info?.current ?? ""}
        heading={starts.heading}
        lost={flow.lost}
        onAsk={flow.ask}
        onClose={onClose}
        onRestart={flow.restart}
        output={starts.output}
        port={port}
        step={step}
        text={flow.text}
      />
    );
  }
  return isRestart(step) ? (
    <RestartBody
      onClose={onClose}
      onKeepWaiting={flow.keepWaiting}
      onReload={reload}
      port={port}
      step={step}
    />
  ) : null;
};
