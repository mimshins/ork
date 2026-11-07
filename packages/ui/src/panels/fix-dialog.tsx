/**
 * @file The Feedback panel's Propose fix confirmation: it starts a paid run, so
 *   it asks, naming the project, with the Run workflow dialog's driver field as
 *   `ork feedback apply --driver` gives, and its command follows the choice. A
 *   started run takes the focus in the Monitor; a refusal stays in the dialog.
 */

import type { FeedbackItem } from "@krapht/ork-server/client";
import { useRef, useState } from "react";

import { ConfirmDialog } from "../components/dialog.tsx";
import { DriverField } from "./run-fields.tsx";
import type { DriverChoice } from "./run-form.ts";
import type { FeedbackActs } from "./use-feedback-acts.ts";

const fixWords = (root: string): string =>
  `Starts a run of \`ork:feedback-apply\` in \`${root}\`. It's a paid run, like any you start. A worker reads this item and that project's records of it, and Ork commits the smallest change that would stop it on a branch of its own, in a worktree. The worker reads and edits files and runs no commands. Then you're asked to keep or discard the branch, in Decisions.`;

export const FixDialog = ({
  item,
  id,
  root,
  acts,
  open,
  onOpenChange,
}: {
  item: FeedbackItem;
  /** The item's short id, as the CLI takes it. */
  id: string;
  /** The project's root, once its detail says it. */
  root: string | null;
  acts: FeedbackActs;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  /** The workflow's own driver, unless one is chosen. */
  const [driver, setDriver] = useState<DriverChoice>("");
  /** A started fix's run takes the focus in the Monitor, not the button. */
  const started = useRef(false);
  return (
    <ConfirmDialog
      cli={`ork feedback apply ${id}${driver === "" ? "" : ` --driver ${driver}`}`}
      confirm="Start run"
      description={fixWords(root ?? "its project")}
      finalFocus={() => {
        const away = started.current;
        started.current = false;
        return !away;
      }}
      onConfirm={async () => {
        const refused = await acts.apply(item, driver);
        started.current = refused === null;
        return refused;
      }}
      onOpenChange={onOpenChange}
      open={open}
      pending="Starting…"
      title={`Propose a fix for ${id}?`}
      variant="primary"
    >
      <DriverField
        onChange={setDriver}
        value={driver}
      />
    </ConfirmDialog>
  );
};
