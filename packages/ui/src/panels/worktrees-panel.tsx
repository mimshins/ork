/**
 * @file The Worktrees panel: what `ork worktrees` shows, for every project Ork
 *   knows, with cleanup a click away. The tools hold the project filter, Clean
 *   merged… and Reload; under them, one card per project with something left,
 *   and a line counting the others. Each row has Open run and Remove…; the
 *   arrow keys move between the rows' same buttons, and Tab works without them.
 *   Nothing is removed without a confirm.
 */

import type { WorktreesProject } from "@krapht/ork-server/client";

import { ALL_PROJECTS } from "./project-options.ts";
import { useKeptFocus } from "./use-kept-focus.ts";
import { useWorktreesActs } from "./use-worktrees-acts.ts";
import { useWorktrees } from "./use-worktrees.ts";
import { moveAmongRows, ProjectCard } from "./worktree-card.tsx";
import { WorktreesDialogs } from "./worktrees-dialogs.tsx";
import { cleanBlocked, counted } from "./worktrees-model.ts";
import { NoWorktrees, ReadFailed, WorktreesTools } from "./worktrees-tools.tsx";

import styles from "./worktrees.module.css";

/** A project without the rows the server just removed. */
const without = (
  project: WorktreesProject,
  gone: ReadonlySet<string>,
): WorktreesProject => ({
  ...project,
  items: project.items.filter(item => !gone.has(`${project.root}|${item.key}`)),
});

export const WorktreesPanel = () => {
  const view = useWorktrees();
  const { read, shown, filter } = view;
  const one = filter === ALL_PROJECTS ? null : filter;
  const listKey = (shown ?? [])
    .flatMap(p => p.items.map(item => `${p.root}|${item.key}`))
    .join("\n");
  const { panel, onFocus } = useKeptFocus(listKey, "[data-worktree-row]");
  const acts = useWorktreesActs(panel, view.load);
  const projects = (shown ?? []).map(project => without(project, acts.gone));
  const cards = projects.filter(
    p => p.items.length > 0 || p.error !== undefined,
  );
  const others = projects.length - cards.length;
  const merged = projects.filter(p => p.items.some(i => i.state === "merged"));
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- notes where the focus is, and moves it among the rows' buttons
    <div
      aria-label="Worktrees"
      className={styles["panel"]}
      onFocus={onFocus}
      onKeyDown={moveAmongRows}
      ref={panel}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- where the focus can land, not a landmark: the dock names the panel
      role="group"
      tabIndex={-1}
    >
      <WorktreesTools
        cleanBlocked={cleanBlocked(
          shown === null ? null : projects,
          one !== null,
        )}
        cleanButton={acts.cleanButton}
        failed={read.status === "failed"}
        filter={filter}
        items={shown === null ? null : projects.flatMap(p => p.items)}
        onClean={acts.openClean}
        onFilter={view.setFilter}
        onReload={() => void view.load()}
        options={view.options}
        updating={read.status === "loading" && shown !== null}
      />
      {read.status === "failed" ? <ReadFailed error={read.error} /> : null}
      {shown === null && read.status !== "failed" ? (
        <p className={styles["message"]}>Reading worktrees…</p>
      ) : null}
      {shown !== null && cards.length === 0 ? (
        <NoWorktrees
          one={one === null ? null : (projects[0]?.name ?? one)}
          projects={view.all?.length ?? 0}
        />
      ) : null}
      {cards.map(project => (
        <ProjectCard
          acts={acts.rowActs}
          key={project.root}
          project={project}
        />
      ))}
      {one === null && cards.length > 0 && others > 0 ? (
        <p className={styles["note"]}>
          {`Nothing left in ${counted(others, "other project")}.`}
        </p>
      ) : null}
      <WorktreesDialogs
        acts={acts}
        load={view.load}
        merged={merged}
        project={one ?? undefined}
      />
    </div>
  );
};
