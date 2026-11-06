/**
 * @file A person's note on a run, or one node that ran in it, written where the
 *   run is shown: the Monitor. It joins the run's feedback as theirs and groups
 *   into an item like any record. Its choices are lists, so nothing can be
 *   mistyped, and its CLI twin follows them. A refusal stays in the dialog;
 *   once it's noted, a toast names the item it joined.
 */

import { useId, useState } from "react";

import { Button, IconButton } from "../components/button.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Dialog, DialogActions } from "../components/dialog.tsx";
import { IconNote } from "../components/icons.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import { DialogForm, Reason, Refusal, SEND_KEYS } from "./dialog-form.tsx";
import * as note from "./note-model.ts";

const asOptions = (values: readonly string[]) =>
  values.map(value => ({ value, label: value }));

/** Records a note; resolves to its refusal, or null once it's noted. */
export type SendNote = (
  body: ReturnType<typeof note.noteBody>,
) => Promise<string | null>;

const NoteForm = ({
  runId,
  node,
  onSend,
  onDone,
}: {
  runId: string;
  node: string | undefined;
  onSend: SendNote;
  onDone: () => void;
}) => {
  const [draft, setDraft] = useState<note.NoteDraft>(note.EMPTY_NOTE);
  const [adding, setAdding] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const reasonId = useId();
  const severityId = useId();
  const blocked = note.noteBlocked(draft);
  const change = (next: Partial<note.NoteDraft>): void => {
    setDraft(before => ({ ...before, ...next }));
  };
  const add = async (): Promise<void> => {
    if (blocked !== null || adding) return;
    setAdding(true);
    setRefusal(null);
    const refused = await onSend(note.noteBody(node, draft));
    setAdding(false);
    setRefusal(refused);
    if (refused === null) onDone();
  };
  return (
    <DialogForm
      onSend={() => {
        void add();
      }}
    >
      <TextField
        description="Its first line is the title."
        label="Note"
        multiline
        onChange={text => {
          change({ text });
        }}
        required
        value={draft.text}
      />
      <Select
        label="Rating"
        onChange={rating => {
          change({ rating });
        }}
        options={note.NOTE_RATINGS}
        value={draft.rating}
      />
      <Select
        label="Kind"
        onChange={kind => {
          change({ kind });
        }}
        options={asOptions(note.NOTE_KINDS)}
        value={draft.kind}
      />
      <Select
        label="Severity"
        onChange={severity => {
          change({ severity });
        }}
        describedBy={severityId}
        options={asOptions(note.NOTE_SEVERITIES)}
        value={note.severityOf(draft)}
      />
      {/* Always there, so a change of its words is heard. */}
      <Reason
        id={severityId}
        why={
          note.fromRating(draft) ? "Severity: high, from the bad rating." : null
        }
      />
      <CopyCommand command={note.noteCommand(runId, node, draft)} />
      <Reason
        id={reasonId}
        why={blocked}
      />
      <Refusal text={refusal} />
      <DialogActions>
        <Button
          disabled={adding}
          onClick={onDone}
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
          {adding ? "Adding…" : "Add note"}
        </Button>
      </DialogActions>
    </DialogForm>
  );
};

export type NoteCheck = { enabled: true } | { enabled: false; why: string };

const ALWAYS: NoteCheck = { enabled: true };

/**
 * The way to a note: for a node, "Note…" after its controls; for the run, an
 * icon among the stat strip's. A node that never ran has nothing to note.
 */
export const NoteButton = ({
  runId,
  node,
  check = ALWAYS,
  onSend,
}: {
  runId: string;
  node?: string | undefined;
  check?: NoteCheck;
  onSend: SendNote;
}) => {
  const [open, setOpen] = useState(false);
  const target = node ?? `run ${runId}`;
  const label = check.enabled
    ? `Note on ${target}`
    : `Note on ${target}: ${check.why}`;
  const cli = `ork feedback note ${runId}${node === undefined ? "" : ` ${node}`} -m <text>`;
  const show = () => {
    setOpen(true);
  };
  return (
    <>
      {node === undefined ? (
        <IconButton
          cli={cli}
          label={label}
          onClick={show}
        >
          <IconNote />
        </IconButton>
      ) : (
        <Button
          aria-label={label}
          cli={cli}
          disabled={!check.enabled}
          focusableWhenDisabled
          onClick={show}
          tip={check.enabled ? undefined : label}
        >
          <IconNote />
          Note…
        </Button>
      )}
      <Dialog
        description={`It joins run ${runId}'s feedback as yours, and groups into an item like any record.`}
        onOpenChange={setOpen}
        open={open}
        title={
          node === undefined
            ? `Note on run \`${runId}\``
            : `Note on \`${node}\``
        }
      >
        <NoteForm
          node={node}
          onDone={() => {
            setOpen(false);
          }}
          onSend={onSend}
          runId={runId}
        />
      </Dialog>
    </>
  );
};
