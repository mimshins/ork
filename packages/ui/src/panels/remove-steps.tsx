/**
 * @file Remove…'s two bodies. The choice: the item's facts (project, run with
 *   Open run, path to copy, state), "Also delete the branch" with what that
 *   loses, the plan in a well, as core words it, and the CLI twin. What's lost,
 *   shown only when removing loses work: its heading takes the focus, then
 *   git's lines of changes and commits, each in a well the keys can scroll.
 */

import type {
  RemovePlanAnswer,
  WorktreeRow,
  WorktreesProject,
} from "@krapht/ork-server/client";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { Button } from "../components/button.tsx";
import { Checkbox } from "../components/checkbox.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { TextWell } from "../components/text-well.tsx";
import {
  branchHint,
  kindOf,
  lostNote,
  openRunName,
  removeTwin,
} from "./worktrees-model.ts";

import styles from "./worktrees.module.css";

/**
 * The item's state, saying what "not merged" is measured against: as the plan
 * read it, or as the list did until the plan is read.
 */
const stateWords = (
  row: WorktreeRow,
  plan: RemovePlanAnswer | undefined,
  head: string,
): string => {
  const parts =
    plan?.parts.map(part => part.text) ??
    row.parts.map(part =>
      part.text.replace(/ not merged$/u, ` not merged into ${head}`),
    );
  const merged = plan?.merged ?? row.merged;
  return parts.join(" · ") || (merged ? `merged into ${head}` : "");
};

const UNREAD = "Nothing to show: its state couldn't be read.";

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt className={styles["factName"]}>{name}</dt>
    <dd className={styles["factValue"]}>{children}</dd>
  </>
);

export const PlanWell = ({
  plan,
  label,
  reading,
}: {
  plan: RemovePlanAnswer | undefined;
  label: string;
  reading: string | undefined;
}) => (
  <TextWell
    label={label}
    reading={reading}
    steady
  >
    {plan === undefined ? (
      UNREAD
    ) : (
      <>
        {plan.line.text}
        {plan.line.reason === undefined ? null : (
          <span className={styles["reason"]}>{` (${plan.line.reason})`}</span>
        )}
      </>
    )}
  </TextWell>
);

export type ChoiceProps = {
  row: WorktreeRow;
  project: WorktreesProject;
  plan: RemovePlanAnswer | undefined;
  reading: boolean;
  busy: boolean;
  deleteBranch: boolean;
  onDeleteBranch: (next: boolean) => void;
  onOpenRun: () => void;
};

export const Choice = (props: ChoiceProps) => {
  const { row, project, plan } = props;
  const hintId = useId();
  const head = project.head ?? "the current branch";
  return (
    <div className={styles["step"]}>
      <dl className={styles["facts"]}>
        <Fact name="Project">{`${project.name}  ${project.root}`}</Fact>
        <Fact name="Run">
          {`${row.runId} · ${row.nodeId}`}
          <Button
            aria-label={openRunName(row)}
            disabled={!row.run.known || props.busy}
            focusableWhenDisabled
            onClick={props.onOpenRun}
            tip={row.run.known ? undefined : "It isn't in Ork's records."}
            variant="ghost"
          >
            Open run
          </Button>
        </Fact>
        {row.path === null ? null : <Fact name="Path">{row.path}</Fact>}
        <Fact name="State">{stateWords(row, plan, head)}</Fact>
      </dl>
      {kindOf(row) === "worktree" && row.branch !== undefined ? (
        <>
          <Checkbox
            checked={props.deleteBranch}
            describedBy={hintId}
            disabled={props.busy}
            label={`Also delete the branch ${row.branch}`}
            onChange={props.onDeleteBranch}
          />
          <p
            className={styles["note"]}
            id={hintId}
          >
            <CodeText text={branchHint(plan ?? row, head)} />
          </p>
        </>
      ) : null}
      <p className={styles["caption"]}>Plan</p>
      <PlanWell
        label="Plan"
        plan={plan}
        reading={props.reading ? "Reading its state…" : undefined}
      />
      <CopyCommand
        command={removeTwin(
          row.key,
          plan?.deleteBranch ?? props.deleteBranch,
          plan?.force ?? false,
        )}
      />
    </div>
  );
};

const LostWell = ({
  title,
  label,
  lines,
  more,
}: {
  title: string;
  label: string;
  lines: readonly string[];
  more: number;
}) => (
  <div className={styles["section"]}>
    <p className={styles["caption"]}>
      <CodeText text={`${title} · ${String(lines.length + more)}`} />
    </p>
    <TextWell
      label={label}
      short
    >
      {lines.join("\n")}
    </TextWell>
    {more > 0 ? (
      <p className={styles["note"]}>{`and ${String(more)} more`}</p>
    ) : null}
  </div>
);

export const Lost = ({
  row,
  plan,
  head,
}: {
  row: WorktreeRow;
  plan: RemovePlanAnswer;
  head: string;
}) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const { losing } = plan;
  const unmerged = `Commits not merged into ${head}`;
  return (
    <div className={styles["step"]}>
      <h3
        className={styles["title"]}
        ref={heading}
        tabIndex={-1}
      >
        What&apos;s lost
      </h3>
      {losing.changes.length === 0 ? null : (
        <LostWell
          label="Uncommitted changes"
          lines={losing.changes}
          more={losing.more.changes}
          title="Uncommitted changes"
        />
      )}
      {losing.commits.length === 0 ? null : (
        <LostWell
          label={
            losing.commitsOn === "no branch" ? "Commits on no branch" : unmerged
          }
          lines={losing.commits}
          more={losing.more.commits}
          title={
            losing.commitsOn === "no branch"
              ? "Commits on no branch"
              : `Commits not merged into \`${head}\``
          }
        />
      )}
      <p className={styles["note"]}>{lostNote(plan)}</p>
      <CopyCommand command={removeTwin(row.key, plan.deleteBranch, true)} />
    </div>
  );
};
