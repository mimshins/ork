/**
 * @file The Add lesson dialog: an item's words as one line in a workflow's
 *   lessons file, which every later session of it reads. It names the file and
 *   the project before anything is written, and how full the file is against
 *   the cap a session loads. Seen in more than one workflow, the person picks
 *   one, since a guess would write to the wrong file. A refusal, such as a file
 *   over the cap, stays in the dialog.
 */

import type {
  BodyOf,
  FeedbackDetail,
  FeedbackItem,
} from "@krapht/ork-server/client";
import { useId, useState } from "react";

import { Button } from "../components/button.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Dialog, DialogActions } from "../components/dialog.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import { DialogForm, Reason, Refusal, SEND_KEYS } from "./dialog-form.tsx";
import { lessonBlocked, lessonCommand } from "./lesson-model.ts";
import { LessonWhere } from "./lesson-place.tsx";

export type LessonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: FeedbackItem;
  detail: FeedbackDetail;
  /** Writes it; resolves to the refusal, or null once it's written. */
  onAdd: (body: BodyOf<"accept">) => Promise<string | null>;
};

export const LessonDialog = ({
  open,
  onOpenChange,
  item,
  detail,
  onAdd,
}: LessonDialogProps) => {
  const many = item.workflows.length > 1;
  const [workflow, setWorkflow] = useState<string | null>(
    many ? null : (item.workflows[0] ?? null),
  );
  const [text, setText] = useState(item.title);
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const reasonId = useId();
  const place = detail.lessons.find(p => p.workflow === workflow);
  const blocked = lessonBlocked(workflow, text, place);
  const add = async (): Promise<void> => {
    if (blocked !== null || adding) return;
    setAdding(true);
    setRefusal(null);
    const refused = await onAdd({
      lesson: true,
      ...(text === item.title ? {} : { text }),
      ...(many && workflow !== null ? { workflow } : {}),
    });
    setAdding(false);
    setRefusal(refused);
    if (refused === null) onOpenChange(false);
  };
  return (
    <Dialog
      description={
        workflow === null
          ? "Every later session of the workflow you choose reads it, in the workflow layer of its context."
          : `Every later session of \`${workflow}\` reads it, in the workflow layer of its context.`
      }
      onOpenChange={next => {
        if (!adding) onOpenChange(next);
      }}
      open={open}
      title={
        workflow === null ? "Add a lesson" : `Add a lesson for \`${workflow}\``
      }
    >
      <DialogForm
        onSend={() => {
          void add();
        }}
      >
        {many ? (
          <Select
            label="Workflow (required)"
            onChange={value => {
              setWorkflow(value === "" ? null : value);
            }}
            options={[
              { value: "", label: "Choose one" },
              ...item.workflows.map(name => ({ value: name, label: name })),
            ]}
            value={workflow ?? ""}
          />
        ) : null}
        <TextField
          description="Its first line is the entry; later lines sit under it."
          label="Lesson"
          multiline
          onChange={setText}
          required
          value={text}
        />
        {place === undefined ? null : (
          <LessonWhere
            cap={detail.lessonCap}
            place={place}
          />
        )}
        <CopyCommand command={lessonCommand(item, workflow, text)} />
        <Reason
          id={reasonId}
          why={blocked}
        />
        <Refusal text={refusal} />
        <DialogActions>
          <Button
            disabled={adding}
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            aria-describedby={reasonId}
            aria-keyshortcuts={SEND_KEYS}
            disabled={blocked !== null || adding}
            focusableWhenDisabled
            type="submit"
            variant="primary"
          >
            {adding ? "Adding…" : "Add lesson"}
          </Button>
        </DialogActions>
      </DialogForm>
    </Dialog>
  );
};
