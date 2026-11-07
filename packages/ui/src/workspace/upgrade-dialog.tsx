/**
 * @file The Upgrade Ork dialog (specs/cli/updates.md): `ork upgrade` with its
 *   question asked by a button. One dialog walks every step, from asking the
 *   registry to the restart's wait, so the focus is never handed back to a page
 *   that is about to reload. It can't be closed while the package manager runs
 *   or while `ork ui` restarts. Closed before anything ran, it says nothing was
 *   changed. Closed, it hands the focus to the banner's button, or back to the
 *   panels when the banner has none: its steps take the focus as they open, so
 *   where it came from isn't known.
 */

import { use, useCallback, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { Dialog } from "../components/dialog.tsx";
import { useAppState } from "../state/context.tsx";
import { BANNER_ACTION_ID } from "./banner-model.ts";
import { WorkspaceContext } from "./context.ts";
import { isAsk, UpgradeBody } from "./upgrade-body.tsx";
import { RESTART_TIMING, type RestartTiming } from "./use-restart-wait.ts";
import type { UpgradeStep } from "./use-upgrade.ts";

const reloadPage = (): void => {
  window.location.reload();
};

/** Whether the dialog may close at this step. */
const closable = (step: UpgradeStep): boolean =>
  !["running", "restarting", "back"].includes(step.step) &&
  !(step.step === "plan" && step.starting) &&
  !(step.step === "done" && step.asking);

const ASKING = "Upgrade Ork";

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
  const handBack = (): HTMLElement | false => {
    const action = document.querySelector<HTMLElement>(`#${BANNER_ACTION_ID}`);
    if (action !== null) return action;
    workspace?.focusPanels();
    return false;
  };
  return (
    <Dialog
      finalFocus={handBack}
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
