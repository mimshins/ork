/**
 * @file The Upgrade dialog after Restart: the wait, which is the one thing the
 *   page shows while `ork ui` is away, and how it ended. Back on the upgraded
 *   version, the page reloads itself; back on another, or signed out, or not
 *   back after a minute, it says why and what to do. Everything here is in the
 *   page's main bundle, since the old page's lazily loaded files are gone.
 */

import { useId } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Alert, Elapsed, Foot, Reason, StepHeading } from "./upgrade-parts.tsx";
import type { UpgradeStep } from "./use-upgrade.ts";

import styles from "./update.module.css";

export type RestartStep = Extract<
  UpgradeStep,
  { step: "restarting" | "back" | "gaveUp" | "oldVersion" | "signedOut" }
>;

const Waiting = ({
  step,
  port,
}: {
  step: Extract<RestartStep, { step: "restarting" | "back" }>;
  port: string;
}) => {
  const reasonId = useId();
  return (
    <>
      <StepHeading text="Restarting `ork ui`…" />
      <p className={styles["message"]}>
        {step.step === "back" ? (
          `Ork ${step.version} is up. Reloading…`
        ) : (
          <>
            <CodeText
              text={`Waiting for \`ork ui\` to come back on port ${port}. Runs keep running.`}
            />{" "}
            <Elapsed since={step.since} />
          </>
        )}
      </p>
      <Reason
        id={reasonId}
        why="It closes once `ork ui` is back."
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

export const RestartBody = ({
  step,
  port,
  onClose,
  onKeepWaiting,
  onReload,
}: {
  step: RestartStep;
  port: string;
  onClose: () => void;
  onKeepWaiting: () => void;
  onReload: () => void;
}) => {
  if (step.step === "restarting" || step.step === "back") {
    return (
      <Waiting
        port={port}
        step={step}
      />
    );
  }
  const ended = endedOf(step, port);
  return (
    <>
      <StepHeading
        text={ended.heading}
        tone="failed"
      />
      <Alert text={ended.words} />
      <CopyCommand command={ended.command} />
      <Foot>
        {step.step === "gaveUp" ? (
          <Button onClick={onKeepWaiting}>Keep waiting</Button>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
        {step.step === "signedOut" ? null : (
          <Button
            onClick={onReload}
            variant="primary"
          >
            Reload
          </Button>
        )}
      </Foot>
    </>
  );
};

/** How a wait that didn't end in a reload ended, word for word. */
const endedOf = (
  step: Exclude<RestartStep, { step: "restarting" | "back" }>,
  port: string,
): { heading: string; words: string; command: string } => {
  if (step.step === "gaveUp") {
    return {
      heading: "`ork ui` didn't come back",
      words: `It wasn't back on port ${port} after 60 seconds. Its terminal says why. Start it again there:`,
      command: `ork ui --port ${port}`,
    };
  }
  return step.step === "oldVersion"
    ? {
        heading: `\`ork ui\` is back on ${step.version}`,
        words: `\`ork ui\` is back, but it runs ${step.version}: the \`ork\` it started is not the one that was upgraded. Another \`ork\` may come first on your PATH.`,
        command: "ork upgrade",
      }
    : {
        heading: "This page isn't signed in",
        words:
          "`ork ui` is back, but this page isn't signed in to it. Open it again from a terminal:",
        command: "ork ui",
      };
};
