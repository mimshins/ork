/**
 * @file The Run workflow form's state: what is chosen, what follows from it,
 *   and starting the run. With only one project or workflow to choose from, it
 *   is chosen. The run then arrives on the stream like any other, and the
 *   server's refusal, in the CLI's words, stays in the form.
 */

import type { WorkflowView } from "@krapht/ork-server/client";
import { useEffect, useMemo, useState } from "react";
import { useValue } from "react-containerized-state";

import { toasts } from "../components/toast.tsx";
import { useAppState } from "../state/context.tsx";
import {
  blockedBy,
  initialValues,
  inputsToSend,
  type InputValues,
  NO_FLAGS,
  type RunFlags,
} from "./run-form.ts";

const useWorkflows = (project: string | null): readonly WorkflowView[] => {
  const state = useAppState();
  const read = useValue(state.workflows.state);
  useEffect(() => {
    if (project !== null) void state.workflows.load(project);
  }, [state, project]);
  return read.status === "ready" && read.arg === project ? read.data : [];
};

export const useRunForm = (onDone: () => void) => {
  const state = useAppState();
  const projectsRead = useValue(state.projects.state);
  const projects = useMemo(
    () => (projectsRead.status === "ready" ? projectsRead.data : []),
    [projectsRead],
  );
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [chosenWorkflow, setChosenWorkflow] = useState<string | null>(null);
  const [typed, setTyped] = useState<InputValues>({});
  const [flags, setFlags] = useState<RunFlags>(NO_FLAGS);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const project =
    chosenProject ?? (projects.length === 1 ? (projects[0]?.id ?? null) : null);
  const workflows = useWorkflows(project);
  const named =
    chosenWorkflow ?? (workflows.length === 1 ? workflows[0]?.name : null);
  const workflow = workflows.find(({ name }) => name === named) ?? null;
  const values = useMemo(
    () => ({ ...initialValues(workflow?.inputs ?? {}), ...typed }),
    [workflow, typed],
  );
  const blocked = blockedBy(project, workflow, values);

  useEffect(() => {
    void state.projects.load();
  }, [state]);

  const start = async (): Promise<void> => {
    if (blocked !== null || starting || project === null || workflow === null) {
      return;
    }
    setStarting(true);
    setRefusal(null);
    const answer = await state.startRun({
      project,
      workflow: workflow.name,
      inputs: inputsToSend(workflow.inputs, values),
      ...(flags.driver === "" ? {} : { driver: flags.driver }),
      ...(flags.inPlace ? { inPlace: true } : {}),
      ...(flags.allowDirty ? { allowDirty: true } : {}),
    });
    setStarting(false);
    if (answer.ok) {
      state.selectRun(answer.data.runId);
      toasts.add({ title: `Run ${answer.data.runId} started` });
      onDone();
    } else {
      setRefusal(answer.error);
    }
  };

  return {
    projectsRead,
    projects,
    project,
    workflows,
    workflow,
    values,
    flags,
    blocked,
    refusal,
    starting,
    start,
    setFlags,
    chooseProject: (next: string | null): void => {
      setChosenProject(next);
      setChosenWorkflow(null);
      setTyped({});
    },
    chooseWorkflow: (next: string | null): void => {
      setChosenWorkflow(next);
      setTyped({});
    },
    setInput: (name: string, value: string): void => {
      setTyped(current => ({ ...current, [name]: value }));
    },
  };
};
