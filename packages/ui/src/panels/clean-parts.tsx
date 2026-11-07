/**
 * @file Clean merged…'s parts: a project's plan (its summary, then the plan's
 *   lines in a well, as `ork worktrees clean` prints them, a reason dimmed, and
 *   its CLI twin in its folder), and the result, whose heading takes the focus,
 *   each project's lines as the CLI says them, and where one stopped.
 */

import type { CleanDone, CleanPlanProject } from "@krapht/ork-server/client";
import { type Ref, useEffect, useId, useRef } from "react";

import { Checkbox } from "../components/checkbox.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { GlyphFailed, GlyphSucceeded } from "../components/status-glyphs.tsx";
import { TextWell } from "../components/text-well.tsx";
import { cleanedHeading, cleanSummary } from "./clean-model.ts";
import { cleanTwin } from "./worktrees-model.ts";

import styles from "./worktrees.module.css";

/** Before the plan is read, or when no project has anything merged. */
export const NoPlan = ({
  reading,
  well,
}: {
  reading: boolean;
  well: Ref<HTMLElement>;
}) => (
  <TextWell
    label="Plan"
    reading={reading ? "Reading the plan…" : undefined}
    ref={well}
    steady
  >
    Nothing to clean.
  </TextWell>
);

/** `--branches`: off by default, as the CLI's is. */
export const BranchesBox = ({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) => {
  const hintId = useId();
  return (
    <>
      <Checkbox
        checked={checked}
        describedBy={hintId}
        disabled={disabled}
        label="Also delete the merged branches"
        onChange={onChange}
      />
      <p
        className={styles["note"]}
        id={hintId}
      >
        <CodeText text="`git branch -d`: only branches merged into the current branch." />
      </p>
    </>
  );
};

export const ProjectPlan = ({
  project,
  branches,
  reading,
  well,
}: {
  project: CleanPlanProject;
  branches: boolean;
  reading: boolean;
  /** The first project's well, where the focus starts. */
  well?: Ref<HTMLElement> | undefined;
}) => {
  const summaryId = useId();
  const into = project.head ?? "its detached HEAD";
  return (
    <section
      aria-label={project.name}
      className={styles["section"]}
    >
      <h3 className={styles["name"]}>{project.name}</h3>
      <p className={styles["headMeta"]}>
        <CodeText text={`\`${project.root}\` · into \`${into}\``} />
      </p>
      <p
        className={styles["message"]}
        id={summaryId}
      >
        {reading ? "" : cleanSummary(project.steps)}
      </p>
      <p className={styles["caption"]}>Plan</p>
      <TextWell
        describedBy={summaryId}
        label={`Plan for ${project.name}`}
        reading={reading ? "Reading the plan…" : undefined}
        ref={well}
        steady
      >
        {project.steps.map(step => (
          <span key={step.key}>
            {step.line.text}
            {step.line.reason === undefined ? null : (
              <span
                className={styles["reason"]}
              >{` (${step.line.reason})`}</span>
            )}
            {"\n"}
          </span>
        ))}
      </TextWell>
      <p className={styles["note"]}>
        <CodeText text={`In \`${project.root}\`:`} />
      </p>
      <CopyCommand command={cleanTwin(project.root, branches)} />
    </section>
  );
};

const DoneLines = ({ lines }: { lines: readonly string[] }) => (
  <ul className={styles["result"]}>
    {lines.map(line => (
      <li
        className={styles["resultLine"]}
        key={line}
      >
        <GlyphSucceeded />
        {line}
      </li>
    ))}
  </ul>
);

export const Cleaned = ({ results }: { results: readonly CleanDone[] }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className={styles["step"]}>
      <h3
        className={styles["title"]}
        ref={heading}
        tabIndex={-1}
      >
        {cleanedHeading(results)}
      </h3>
      {results
        .filter(result => result.done.length > 0 || result.error !== undefined)
        .map(result => (
          <section
            aria-label={result.name}
            className={styles["section"]}
            key={result.root}
          >
            <h4 className={styles["name"]}>{result.name}</h4>
            {result.error === undefined ? null : (
              <p className={styles["alert"]}>
                <span className={styles["alertIcon"]}>
                  <GlyphFailed />
                </span>
                <span>
                  <CodeText
                    text={`Stopped in ${result.name}: ${result.error}`}
                  />
                </span>
              </p>
            )}
            {result.error === undefined || result.done.length === 0 ? null : (
              <p className={styles["note"]}>Done before it stopped:</p>
            )}
            <DoneLines lines={result.done} />
          </section>
        ))}
    </div>
  );
};
