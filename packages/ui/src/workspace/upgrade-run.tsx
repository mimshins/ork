/**
 * @file The Upgrade dialog while the package manager runs and once it ends: its
 *   output as it writes it, in a region the focus moves to; a dialog that can't
 *   be closed meanwhile, since that would hide how it ended; then "Upgraded"
 *   with Restart, or how it failed, with the command to run by hand. Nothing is
 *   restarted but by Restart.
 */

import type { UpgradeJob } from "@krapht/ork-server/client";
import { type RefObject, useEffect, useId } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { IconRestart } from "../components/icons.tsx";
import { OutputWell } from "../components/output-well.tsx";
import { Alert, Elapsed, Foot, Reason, StepHeading } from "./upgrade-parts.tsx";
import type { UpgradeStep } from "./use-upgrade.ts";

import styles from "./update.module.css";

export type RunStep = Extract<
  UpgradeStep,
  { step: "running" | "done" | "failed" }
>;

const LOST =
  "Lost the output from `ork ui`. The command may still be running; reconnecting…";

/** The package manager's name: the command's first word. */
const programOf = (job: UpgradeJob): string => job.command[0] ?? "it";

/** Why it failed, in `ork upgrade`'s words, or the spawn error it printed. */
const failure = (job: UpgradeJob, text: string): string => {
  const command = job.command.join(" ");
  const said = text
    .split("\n")
    .findLast(line => line.startsWith("Could not run"));
  return job.code === 127 && said !== undefined
    ? said
    : `\`${command}\` failed (exit ${String(job.code ?? 1)}); the upgrade did not finish.`;
};

const Running = ({
  job,
  lost,
  output,
}: {
  job: UpgradeJob;
  lost: boolean;
  output: RefObject<HTMLElement | null>;
}) => {
  const reasonId = useId();
  useEffect(() => {
    output.current?.focus();
  }, [output]);
  const program = programOf(job);
  return (
    <>
      <p className={styles["message"]}>
        <CodeText text={`Running \`${job.command.join(" ")}\`…`} />{" "}
        <Elapsed since={Date.parse(job.startedAt)} />
      </p>
      {lost ? <Alert text={LOST} /> : null}
      <Reason
        id={reasonId}
        why={`It closes when ${program} ends; closing now would hide how it ended.`}
      />
      <Foot>
        <Button
          aria-describedby={reasonId}
          disabled
          focusableWhenDisabled
        >
          Close
        </Button>
      </Foot>
    </>
  );
};

export const RunBody = ({
  step,
  text,
  lost,
  current,
  port,
  output,
  heading,
  onClose,
  onAsk,
  onRestart,
}: {
  step: RunStep;
  /** The output so far. */
  text: string;
  lost: boolean;
  /** The version this page and `ork ui` run. */
  current: string;
  /** The port `ork ui` comes back on. */
  port: string;
  /** The output while it runs, which takes the focus. */
  output: RefObject<HTMLElement | null>;
  /** How it ended, which takes the focus. */
  heading: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  onAsk: () => void;
  onRestart: () => void;
}) => {
  const { job } = step;
  const label = `Output of ${programOf(job)}`;
  if (step.step === "running") {
    return (
      <>
        <OutputWell
          label={label}
          ref={output}
          text={text}
        />
        <Running
          job={job}
          lost={lost}
          output={output}
        />
      </>
    );
  }
  const well = (
    <OutputWell
      label={label}
      text={text}
    />
  );
  if (step.step === "failed") {
    return (
      <>
        <StepHeading
          ref={heading}
          text="The upgrade did not finish"
          tone="failed"
        />
        <Alert
          text={`${failure(job, text)} Nothing was restarted; \`ork ui\` still runs ${current}.`}
        />
        {well}
        <p className={styles["note"]}>To run it in a terminal yourself:</p>
        <CopyCommand command={job.command.join(" ")} />
        <Foot>
          <Button onClick={onClose}>Close</Button>
          <Button
            onClick={onAsk}
            variant="ghost"
          >
            Try again
          </Button>
        </Foot>
      </>
    );
  }
  return (
    <>
      <StepHeading
        ref={heading}
        text={`Upgraded to ${job.latest}`}
        tone="succeeded"
      />
      <p className={styles["message"]}>
        <CodeText
          text={`Ork ${job.latest} is installed. This page and \`ork ui\` still run ${current} until \`ork ui\` restarts. Restart stops it and starts it again on port ${port} with the same options; runs keep running, and the page reloads itself when it's back.`}
        />
      </p>
      {well}
      <Alert text={step.refusal} />
      <Foot>
        <Button
          onClick={onClose}
          variant="ghost"
        >
          Later
        </Button>
        <Button
          cli={`ork ui --port ${port}`}
          disabled={step.asking}
          focusableWhenDisabled
          onClick={onRestart}
          tip="Stops `ork ui` and starts the new one"
          variant="primary"
        >
          <IconRestart />
          Restart
        </Button>
      </Foot>
    </>
  );
};
