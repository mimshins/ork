/**
 * @file The workflow builder (RFC-008): choose or start a workflow, add nodes
 *   from the palette, connect them, and fill in each one, with what the checks
 *   say on the cards and in a list. It saves the same file a person would
 *   write.
 */

import { useState } from "react";

import { Button } from "../components/button.tsx";
import { ConfirmDialog } from "../components/dialog.tsx";
import { useAppState } from "../state/context.tsx";
import { BuilderBody } from "./builder-body.tsx";
import { actingOutside, errorCount } from "./builder-model.ts";
import { Chooser } from "./chooser.tsx";
import { useBuilder } from "./use-builder.ts";

import styles from "./builder.module.css";

export const BuilderPanel = () => {
  const state = useAppState();
  const builder = useBuilder();
  const { view, opened, refusal, connecting, selected } = builder;
  const [runAsked, setRunAsked] = useState(false);
  const [discardAsked, setDiscardAsked] = useState(false);
  const errors = view === null ? 0 : errorCount(view.diagnostics);
  const acting = view === null ? [] : actingOutside(view.graph);
  const saveThenAsk = async (): Promise<void> => {
    if (await builder.save()) setRunAsked(true);
  };
  const openRun = (): void => {
    if (opened === null) return;
    void state.workflows.load(opened.project);
    void state.runPreset.setValue({
      project: opened.project,
      workflow: opened.name,
    });
    void state.runDialog.setValue(true);
  };
  return (
    <div className={styles["panel"]}>
      <header className={styles["tools"]}>
        <Chooser builder={builder} />
        {view === null ? null : (
          <div className={styles["actions"]}>
            <Button
              disabled={!builder.canUndo}
              focusableWhenDisabled
              onClick={() => {
                void builder.undo();
              }}
            >
              Undo
            </Button>
            <Button
              disabled={!view.draft}
              focusableWhenDisabled
              onClick={() => {
                setDiscardAsked(true);
              }}
            >
              Discard
            </Button>
            <Button
              disabled={errors > 0 || !view.draft}
              focusableWhenDisabled
              onClick={() => {
                void builder.save();
              }}
              variant="primary"
            >
              Save
            </Button>
            <Button
              disabled={errors > 0}
              focusableWhenDisabled
              onClick={() => {
                void saveThenAsk();
              }}
            >
              Run…
            </Button>
          </div>
        )}
      </header>
      <output className={styles["status"]}>
        {connecting && selected !== null
          ? `Choose the card ${selected} leads to.`
          : view?.changedOnDisk === true
            ? "The file changed since this draft began. Saving will ask before replacing it."
            : view?.draft === true
              ? "Unsaved changes are kept as a draft."
              : ""}
      </output>
      {refusal === null ? null : (
        <p
          className={styles["error"]}
          role="alert"
        >
          {refusal}
        </p>
      )}
      <BuilderBody builder={builder} />
      <ConfirmDialog
        confirm="Discard the draft"
        description="This throws away every unsaved change, and it can't be undone."
        onConfirm={() => {
          setDiscardAsked(false);
          void builder.discard();
        }}
        onOpenChange={setDiscardAsked}
        open={discardAsked}
        title={`Discard the draft of ${opened?.name ?? ""}?`}
      />
      <ConfirmDialog
        confirm="Replace the file"
        description={`${builder.replaceAsked ?? ""} Replacing it loses what changed there.`}
        onConfirm={() => {
          builder.setReplaceAsked(null);
          void builder.save(true);
        }}
        onOpenChange={next => {
          if (!next) builder.setReplaceAsked(null);
        }}
        open={builder.replaceAsked !== null}
        title="The file changed"
      />
      <ConfirmDialog
        confirm="Choose how to run it"
        description={`This starts a real run, which can spend money and commit work.${acting.length === 0 ? "" : ` These nodes act outside its worktree: ${acting.join(", ")}.`}`}
        onConfirm={() => {
          setRunAsked(false);
          openRun();
        }}
        onOpenChange={setRunAsked}
        open={runAsked}
        title={`Run ${opened?.name ?? ""}?`}
      />
    </div>
  );
};
