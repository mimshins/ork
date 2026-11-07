/**
 * @file A project's card in the Worktrees panel: its name, where it is and
 *   which branch "merged" means, then its items in `ork worktrees`' order, or
 *   why git couldn't read them. A row is the item's name and merge badge, its
 *   state in core's words (work removing would lose in a heavier weight), and
 *   Open run and Remove…, each named for its row; Remove… is described by the
 *   row's state, so tabbing to it reads what it would remove. A row draws again
 *   only when its item changes.
 */

import type { WorktreeRow, WorktreesProject } from "@krapht/ork-server/client";
import { type KeyboardEvent, memo, useId } from "react";

import { Button } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { WorktreeBadge } from "../components/status-badge.tsx";
import { GlyphFailed } from "../components/status-glyphs.tsx";
import { Unseen } from "../components/unseen.tsx";
import {
  headMeta,
  openRunName,
  removeName,
  removeTwin,
  rowParts,
} from "./worktrees-model.ts";

import styles from "./worktrees.module.css";

const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowDown: at => at + 1,
  ArrowUp: at => at - 1,
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * ↑ ↓ Home End move from a row's button to the same button in another row,
 * across cards: a shortcut, since Tab reaches each.
 */
export const moveAmongRows = (event: KeyboardEvent<HTMLElement>): void => {
  const move = MOVES[event.key];
  const { target } = event;
  if (move === undefined || !(target instanceof HTMLElement)) return;
  const act = target.dataset["act"];
  if (act === undefined) return;
  const same = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      `[data-worktree-row] [data-act="${act}"]`,
    ),
  ];
  const last = same.length - 1;
  const to =
    same[Math.max(0, Math.min(last, move(same.indexOf(target), last)))];
  if (to === undefined) return;
  event.preventDefault();
  to.focus();
};

export type RowActs = {
  openRun: (row: WorktreeRow) => void;
  remove: (row: WorktreeRow, project: WorktreesProject) => void;
};

type RowProps = { row: WorktreeRow; project: WorktreesProject; acts: RowActs };

const Row = ({ row, project, acts }: RowProps) => {
  const metaId = useId();
  const cliId = useId();
  const twin = removeTwin(project.root, row.key, row.path === null, false);
  const parts = rowParts(row);
  const { refusal } = row.remove;
  return (
    <li
      className={styles["row"]}
      data-worktree-row={row.key}
    >
      <p className={styles["rowName"]}>
        {row.label}
        <Unseen>, </Unseen>
      </p>
      <span className={styles["badge"]}>
        <WorktreeBadge state={row.state} />
      </span>
      <p
        className={styles["meta"]}
        id={metaId}
      >
        {parts.map((part, index) => (
          <span
            className={part.risk ? styles["risk"] : undefined}
            // The parts are a fixed sequence; their text can repeat.
            // oxlint-disable-next-line react/no-array-index-key -- see above
            key={index}
          >
            {part.text}
            {index < parts.length - 1 ? " ·" : ""}
          </span>
        ))}
      </p>
      {/* A description set here takes the place of the one `cli` gives. */}
      <span
        hidden
        id={cliId}
      >
        {`CLI: ${twin}`}
      </span>
      <div className={styles["actions"]}>
        <Button
          aria-label={openRunName(row)}
          data-act="open"
          disabled={!row.run.known}
          focusableWhenDisabled
          onClick={() => {
            acts.openRun(row);
          }}
          tip={row.run.known ? undefined : "It isn't in Ork's records."}
          variant="ghost"
        >
          Open run
        </Button>
        <Button
          aria-describedby={`${metaId} ${cliId}`}
          aria-label={removeName(row)}
          cli={twin}
          data-act="remove"
          disabled={refusal !== undefined}
          focusableWhenDisabled
          onClick={() => {
            acts.remove(row, project);
          }}
          tip={
            refusal === undefined
              ? undefined
              : `${refusal[0]?.toUpperCase() ?? ""}${refusal.slice(1)}.`
          }
        >
          {row.remove.label}
        </Button>
      </div>
    </li>
  );
};

/** Draws a row again only when its item, or its project's place, changes. */
const SameRow = memo(
  Row,
  (before, after) =>
    before.acts === after.acts &&
    before.project.root === after.project.root &&
    before.project.head === after.project.head &&
    JSON.stringify(before.row) === JSON.stringify(after.row),
);

export const ProjectCard = ({
  project,
  acts,
}: {
  project: WorktreesProject;
  acts: RowActs;
}) => {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={styles["card"]}
    >
      <div className={styles["head"]}>
        <h3
          className={styles["name"]}
          id={headingId}
        >
          {project.name}
        </h3>
        <p className={styles["headMeta"]}>{headMeta(project).join(" · ")}</p>
      </div>
      {project.error === undefined ? (
        <ul
          aria-label={`Worktrees in ${project.name}`}
          className={styles["list"]}
        >
          {project.items.map(row => (
            <SameRow
              acts={acts}
              key={row.key}
              project={project}
              row={row}
            />
          ))}
        </ul>
      ) : (
        <p className={styles["alert"]}>
          <span className={styles["alertIcon"]}>
            <GlyphFailed />
          </span>
          <span>
            <CodeText
              text={`Could not read ${project.name}'s worktrees: ${project.error}`}
            />
          </span>
        </p>
      )}
      {project.fix === undefined ? null : (
        <>
          <p className={styles["note"]}>
            If it moved, this points Ork at its new place:
          </p>
          <CopyCommand command={project.fix} />
        </>
      )}
    </section>
  );
};
