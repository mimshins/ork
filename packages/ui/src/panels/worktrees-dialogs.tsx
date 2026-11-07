/**
 * @file The Worktrees panel's open dialog, if any: Remove… for one row, or
 *   Clean merged… for the projects the filter keeps. Each opening draws its
 *   dialog afresh, so it reads its plan again.
 */

import type { WorktreesProject } from "@krapht/ork-server/client";

import { useAppState } from "../state/context.tsx";
import { CleanDialog } from "./clean-dialog.tsx";
import { RemoveDialog } from "./remove-dialog.tsx";
import type { WorktreesActs } from "./use-worktrees-acts.ts";

export const WorktreesDialogs = ({
  acts,
  project,
  merged,
  load,
}: {
  acts: WorktreesActs;
  /** The filter's project, or every project. */
  project: string | undefined;
  /** The projects in scope with something merged. */
  merged: readonly WorktreesProject[];
  load: () => Promise<void>;
}) => {
  const { client } = useAppState();
  const { opened, open } = acts;
  if (opened?.kind === "remove") {
    return (
      <RemoveDialog
        client={client}
        finalFocus={acts.removeFocus}
        key={opened.id}
        onClose={acts.close}
        onOpenRun={() => {
          acts.openRemovedRun(opened.row);
        }}
        onRemoved={plan => {
          acts.removed(opened.row, opened.project, plan, opened.index);
        }}
        open={open}
        project={opened.project}
        row={opened.row}
        target={opened.target}
      />
    );
  }
  return opened?.kind === "clean" ? (
    <CleanDialog
      client={client}
      finalFocus={acts.cleanFocus}
      key={opened.id}
      onCleaned={() => void load()}
      onClose={acts.cleanClosed}
      open={open}
      project={project}
      scope={merged.map(({ root, name, head }) => ({
        root,
        name,
        head,
        steps: [],
      }))}
    />
  ) : null;
};
