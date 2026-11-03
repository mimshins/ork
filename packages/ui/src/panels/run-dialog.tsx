/**
 * @file The Run workflow dialog: a project, a workflow, its inputs and the run
 *   flags, the command that does the same, and why it cannot start yet, which
 *   is said aloud as it changes.
 */

import { useValue } from "react-containerized-state";

import { Button } from "../components/button.tsx";
import { Combobox } from "../components/combobox.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Dialog, DialogActions } from "../components/dialog.tsx";
import { useAppState } from "../state/context.tsx";
import { FlagFields, InputFields, NoProjects } from "./run-fields.tsx";
import { commandOf, workflowPlaceholder } from "./run-form.ts";
import { useRunForm } from "./use-run-form.ts";

import styles from "./runs.module.css";

const RunForm = ({ onDone }: { onDone: () => void }) => {
  const form = useRunForm(onDone);
  const { projectsRead, projects, project, workflows, workflow } = form;
  const { readingWorkflows } = form;
  const { values, flags, blocked, refusal, starting } = form;
  const close = (
    <DialogActions>
      <Button
        onClick={onDone}
        variant="ghost"
      >
        Close
      </Button>
    </DialogActions>
  );
  if (projectsRead.status === "failed") {
    return (
      <>
        <p
          className={styles["error"]}
          role="alert"
        >
          Cannot read the projects: {projectsRead.error}
        </p>
        {close}
      </>
    );
  }
  if (projectsRead.status === "ready" && projects.length === 0) {
    return (
      <>
        <NoProjects />
        {close}
      </>
    );
  }
  return (
    <form
      className={styles["form"]}
      onSubmit={event => {
        event.preventDefault();
        void form.start();
      }}
    >
      <Combobox
        empty="No project matches."
        label="Project"
        onChange={form.chooseProject}
        options={projects.map(({ id }) => ({ value: id, label: id }))}
        placeholder="Type to find a project"
        value={project}
      />
      <Combobox
        disabled={project === null || workflows.length === 0}
        empty="No workflow matches."
        label="Workflow"
        onChange={form.chooseWorkflow}
        options={workflows.map(({ name }) => ({ value: name, label: name }))}
        placeholder={workflowPlaceholder(
          project,
          readingWorkflows,
          workflows.length,
        )}
        value={workflow?.name ?? null}
      />
      {workflow === null ? null : (
        <InputFields
          onChange={form.setInput}
          values={values}
          workflow={workflow}
        />
      )}
      <FlagFields
        flags={flags}
        onChange={change => {
          form.setFlags(current => ({ ...current, ...change }));
        }}
      />
      {workflow === null ? null : (
        <CopyCommand command={commandOf(workflow, values, flags)} />
      )}
      <output className={styles["reason"]}>{blocked}</output>
      {refusal === null ? null : (
        <p
          className={styles["error"]}
          role="alert"
        >
          {refusal}
        </p>
      )}
      <DialogActions>
        <Button
          onClick={onDone}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          disabled={blocked !== null || starting}
          type="submit"
          variant="primary"
        >
          {starting ? "Starting…" : "Start run"}
        </Button>
      </DialogActions>
    </form>
  );
};

export const RunDialog = () => {
  const { runDialog } = useAppState();
  const open = useValue(runDialog);
  return (
    <Dialog
      description="Starts in the background, from the project's root."
      onOpenChange={next => {
        void runDialog.setValue(next);
      }}
      open={open}
      title="Run workflow"
    >
      <RunForm
        onDone={() => {
          void runDialog.setValue(false);
        }}
      />
    </Dialog>
  );
};
