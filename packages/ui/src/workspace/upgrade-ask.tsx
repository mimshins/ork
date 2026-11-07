/**
 * @file The Upgrade dialog's first steps: asking the registry, which only
 *   reads, then what it found. A plan with the installer's command shows that
 *   exact command, which the server runs as it is, behind Upgrade, never the
 *   default; advice has nothing to run, so no run button, and shows each of its
 *   commands as a block under its words. Cancel stays the same button from the
 *   asking to the plan, so the focus never jumps, and Try again hands the focus
 *   to it before it goes.
 */

import { type RefObject, useEffect, useId } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import {
  Alert,
  focusLost,
  Foot,
  Reason,
  ReleaseLink,
  RunningNow,
  StepHeading,
  VersionsLine,
} from "./upgrade-parts.tsx";
import type { ActionPlan, UpgradeStep } from "./use-upgrade.ts";

import styles from "./update.module.css";

export type AskStep = Extract<
  UpgradeStep,
  { step: "checking" | "unreachable" | "latest" | "plan" }
>;

const asking = (registry: string | null): string =>
  registry === null
    ? "Asking the npm registry for the latest version…"
    : `Asking the registry at \`${registry}\` for the latest version…`;

const PlanFacts = ({ plan }: { plan: ActionPlan }) => (
  <dl className={styles["facts"]}>
    <dt className={styles["factName"]}>Installed with</dt>
    <dd className={styles["factValue"]}>
      {plan.installer?.label ?? "Ork couldn't tell"}
    </dd>
    {plan.kind === "command" ? (
      <>
        <dt className={styles["factName"]}>Command</dt>
        <dd className={styles["factValue"]}>
          <section aria-label="Command to run">
            <CopyCommand command={plan.command.join(" ")} />
          </section>
        </dd>
      </>
    ) : (
      <>
        <dt className={styles["factName"]}>What to do</dt>
        <dd className={styles["factValue"]}>
          <p className={styles["adviceWords"]}>
            <CodeText text={plan.words} />
          </p>
          {plan.commands.map(command => (
            <CopyCommand
              command={command}
              key={command}
            />
          ))}
        </dd>
      </>
    )}
  </dl>
);

const PlanBody = ({ plan }: { plan: ActionPlan }) => (
  <>
    <VersionsLine
      current={plan.current}
      latest={plan.latest}
    />
    <p className={styles["message"]}>
      What changed:{" "}
      <ReleaseLink url={plan.releaseNotes}>{plan.releaseNotes}</ReleaseLink>
    </p>
    <PlanFacts plan={plan} />
    {plan.kind === "advice" ? (
      <p className={styles["note"]}>
        Ork runs only a package manager&apos;s own command from here; this one
        is yours to run.
      </p>
    ) : null}
    <RunningNow ids={plan.running} />
    <p className={styles["note"]}>The same, in a terminal:</p>
    <CopyCommand command="ork upgrade" />
  </>
);

const Middle = ({
  step,
  registry,
}: {
  step: AskStep;
  registry: string | null;
}) => {
  if (step.step === "plan") return <PlanBody plan={step.plan} />;
  if (step.step === "latest") {
    return (
      <StepHeading
        text={`Ork ${step.current} is the latest version.`}
        tone="succeeded"
      />
    );
  }
  return step.step === "unreachable" ? (
    <>
      <Alert
        icon
        text={step.words}
      />
      <p className={styles["message"]}>Nothing was changed.</p>
    </>
  ) : (
    <section
      aria-busy="true"
      aria-label="Asking"
      className={styles["message"]}
    >
      <CodeText text={asking(registry)} />
    </section>
  );
};

export const AskBody = ({
  step,
  registry,
  first,
  onClose,
  onAsk,
  onUpgrade,
}: {
  step: AskStep;
  registry: string | null;
  /** Cancel, or Close: where the focus starts. */
  first: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAsk: () => void;
  onUpgrade: () => void;
}) => {
  const reasonId = useId();
  // Back from a failed upgrade's Try again, the focus starts here again.
  useEffect(() => {
    if (focusLost()) first.current?.focus();
  }, [first]);
  const command = step.step === "plan" && step.plan.kind === "command";
  const runnable = step.step === "checking" || command;
  const starting = step.step === "plan" && step.starting;
  return (
    <>
      <Middle
        registry={registry}
        step={step}
      />
      <Alert text={step.step === "plan" ? step.refusal : null} />
      <Reason
        id={reasonId}
        why={step.step === "checking" ? "Asking the registry…" : null}
      />
      <Foot note={runnable ? "It runs on this machine as you." : undefined}>
        {step.step === "unreachable" ? (
          <Button
            key="again"
            onClick={() => {
              // It goes while the registry is asked: the focus waits on Cancel,
              // which stays through every step.
              first.current?.focus();
              onAsk();
            }}
            variant="ghost"
          >
            Try again
          </Button>
        ) : null}
        <Button
          disabled={starting}
          focusableWhenDisabled
          key="close"
          onClick={onClose}
          ref={first}
          variant={runnable ? "ghost" : "default"}
        >
          {runnable ? "Cancel" : "Close"}
        </Button>
        {runnable ? (
          <Button
            aria-describedby={reasonId}
            disabled={!command || starting}
            focusableWhenDisabled
            key="upgrade"
            onClick={onUpgrade}
            variant="primary"
          >
            {step.step === "plan"
              ? `Upgrade to ${step.plan.latest}`
              : "Upgrade"}
          </Button>
        ) : null}
      </Foot>
    </>
  );
};
