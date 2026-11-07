/**
 * @file The Upgrade Ork dialog (specs/cli/updates.md): `ork upgrade` with its
 *   question asked by a button. One dialog walks every step, from asking the
 *   registry to the restart's wait, so the focus is never handed back to a page
 *   that is about to reload. It can't be closed while the package manager runs
 *   or while `ork ui` restarts. Closed before anything ran, it says nothing was
 *   changed.
 */

import {
  type RefObject,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useValue } from "react-containerized-state";

import { Dialog } from "../components/dialog.tsx";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "./context.ts";
import { AskBody, type AskStep } from "./upgrade-ask.tsx";
import { RestartBody, type RestartStep } from "./upgrade-restart.tsx";
import { RunBody, type RunStep } from "./upgrade-run.tsx";
import {
  RESTART_TIMING,
  type RestartTiming,
  useRestartWait,
} from "./use-restart-wait.ts";
import { type UpgradeStep, useUpgrade } from "./use-upgrade.ts";

const reloadPage = (): void => {
  window.location.reload();
};

const isAsk = (step: UpgradeStep): step is AskStep =>
  ["checking", "unreachable", "latest", "plan"].includes(step.step);

const isRun = (step: UpgradeStep): step is RunStep =>
  ["running", "done", "failed"].includes(step.step);

const isRestart = (step: UpgradeStep): step is RestartStep =>
  !isAsk(step) && !isRun(step);

/** Whether the dialog may close at this step. */
const closable = (step: UpgradeStep): boolean =>
  !["running", "restarting", "back"].includes(step.step) &&
  !(step.step === "plan" && step.starting) &&
  !(step.step === "done" && step.asking);

const ASKING = "Upgrade Ork";

/** Where the focus can start: Cancel, the job's output, or how it ended. */
type Starts = {
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

const UpgradeBody = ({
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
    announce,
    onAsked: () => void version.refresh(),
  });
  const { step, setStep } = flow;
  useRestartWait({ client, step, setStep, announce, reload, timing });
  useEffect(() => {
    onStep(step);
  }, [step, onStep]);
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

export const UpgradeDialog = ({
  timing = RESTART_TIMING,
  reload = reloadPage,
}: {
  timing?: RestartTiming;
  reload?: () => void;
}) => {
  const { version } = useAppState();
  const workspace = use(WorkspaceContext);
  const opening = useValue(version.dialog);
  const info = useValue(version.info);
  const first = useRef<HTMLButtonElement>(null);
  const output = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const ended = opening === "job" && info?.job?.state !== "running";
  const start = opening === "job" ? (ended ? heading : output) : first;
  const [title, setTitle] = useState(ASKING);
  const tracked = useRef({ closable: true, ran: false });
  const onStep = useCallback((step: UpgradeStep): void => {
    tracked.current = {
      closable: closable(step),
      ran: tracked.current.ran || "job" in step,
    };
    // The title stays on the upgrade through the restart's wait.
    setTitle(before => {
      if (isAsk(step)) return ASKING;
      return "job" in step ? `Upgrading Ork to ${step.job.latest}` : before;
    });
  }, []);
  const close = (): void => {
    if (!tracked.current.closable) return;
    if (!tracked.current.ran) workspace?.announce("Nothing was changed.");
    tracked.current = { closable: true, ran: false };
    setTitle(ASKING);
    version.closeDialog();
  };
  return (
    <Dialog
      initialFocus={start}
      onOpenChange={next => {
        if (!next) close();
      }}
      open={opening !== null}
      size="wide"
      title={title}
    >
      <UpgradeBody
        onClose={close}
        onStep={onStep}
        reload={reload}
        starts={{ first, output, heading }}
        timing={timing}
      />
    </Dialog>
  );
};
