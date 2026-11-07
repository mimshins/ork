/**
 * @file Pause, Continue and Stop, for a run or a node, and a note on it. Each
 *   is enabled only where it applies and says why when it is not, staying
 *   focusable so that can be heard. Stop asks first and Pause does not. A
 *   failed request is a toast; otherwise the change comes back on the run's
 *   stream. A run's note sits among its controls; a node's comes after them.
 */

import { useState } from "react";

import { IconButton } from "../components/button.tsx";
import { ConfirmDialog } from "../components/dialog.tsx";
import { IconPause, IconPlay, IconStop } from "../components/icons.tsx";
import { toasts } from "../components/toast.tsx";
import { useAppState } from "../state/context.tsx";
import type { Action, Actions } from "./monitor-model.ts";
import { NoteButton, type SendNote } from "./note-dialog.tsx";
import { notedWords } from "./note-model.ts";

import styles from "./monitor.module.css";

type Kind = "pause" | "continue" | "stop";

const ALWAYS: Action = { enabled: true };

const labelFor = (word: string, target: string, action: Action): string =>
  action.enabled ? `${word} ${target}` : `${word} ${target}: ${action.why}`;

export const RunControls = ({
  runId,
  node,
  actions,
  note = ALWAYS,
}: {
  runId: string;
  /** The node they act on; the whole run without one. */
  node?: string | undefined;
  actions: Actions;
  /** Whether a note can be added; a run, even one that ended, takes one. */
  note?: Action;
}) => {
  const state = useAppState();
  const [confirming, setConfirming] = useState(false);
  const target = node ?? "run";
  const flag = node === undefined ? "" : ` --node ${node}`;
  const send = (kind: Kind): void => {
    void state.control(kind, runId, node).then(answer => {
      if (!answer.ok) {
        toasts.add({
          title: `Could not ${kind} ${target}`,
          description: answer.error,
        });
      }
      return answer;
    });
  };
  const sendNote: SendNote = async body => {
    const answer = await state.client.call("note", {
      params: { id: runId },
      body,
    });
    if (!answer.ok) return `Could not add the note: ${answer.error}`;
    toasts.add(notedWords(runId, node, answer.data.item));
    return null;
  };
  const noteButton = (
    <NoteButton
      check={note}
      node={node}
      onSend={sendNote}
      runId={runId}
    />
  );
  return (
    <>
      <div
        aria-label={
          node === undefined ? "Run controls" : `Controls for ${node}`
        }
        className={styles["controls"]}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset is for form fields, and these are actions
        role="group"
      >
        <IconButton
          cli={`ork pause ${runId}${flag}`}
          disabled={!actions.pause.enabled}
          focusableWhenDisabled
          label={labelFor("Pause", target, actions.pause)}
          onClick={() => {
            send("pause");
          }}
        >
          <IconPause />
        </IconButton>
        <IconButton
          cli={`ork continue ${runId}${flag}`}
          disabled={!actions.proceed.enabled}
          focusableWhenDisabled
          label={labelFor("Continue", target, actions.proceed)}
          onClick={() => {
            send("continue");
          }}
        >
          <IconPlay />
        </IconButton>
        <IconButton
          cli={`ork stop ${runId}${flag}`}
          disabled={!actions.stop.enabled}
          focusableWhenDisabled
          label={labelFor("Stop", target, actions.stop)}
          onClick={() => {
            setConfirming(true);
          }}
        >
          <IconStop />
        </IconButton>
        <ConfirmDialog
          cli={`ork stop ${runId}${flag}`}
          confirm={node === undefined ? "Stop run" : `Stop ${node}`}
          description={
            node === undefined
              ? "Running nodes are interrupted, and runs it called stop too. It can be resumed later from a terminal."
              : `Its session is interrupted and \`${node}\` fails with \`stopped by the user\`. The workflow's failure rules then apply.`
          }
          onConfirm={() => {
            setConfirming(false);
            send("stop");
          }}
          onOpenChange={setConfirming}
          open={confirming}
          title={node === undefined ? `Stop run ${runId}?` : `Stop ${node}?`}
        />
        {node === undefined ? noteButton : null}
      </div>
      {node === undefined ? null : noteButton}
    </>
  );
};
