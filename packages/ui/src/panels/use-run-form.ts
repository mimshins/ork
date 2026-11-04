/**
 * @file The Run workflow form's state: what is chosen, what follows from it,
 *   and starting the run. With only one project or workflow to choose from, it
 *   is chosen. The run then arrives on the stream like any other, and the
 *   server's refusal, in the CLI's words, stays in the form.
 */

import type { WorkflowView } from "@krapht/ork-server/client";
import { useEffect, useMemo, useRef, useState } from "react";
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
  workflowsProblem,
} from "./run-form.ts";

const NO_WORKFLOWS: readonly WorkflowView[] = [];

const useWorkflows = (project: string | null) => {
  const state = useAppState();
  const read = useValue(state.workflows.state);
  useEffect(() => {
    if (project !== null) void state.workflows.load(project);
  }, [state, project]);
  // What is read may still be for the project chosen before this one.
  const current = read.status !== "idle" && read.arg === project;
  const list = current && read.status === "ready" ? read.data : NO_WORKFLOWS;
  return {
    list,
    reading: !current || read.status === "loading",
    problem: workflowsProblem(
      project,
      current ? read : { status: "idle" },
      list.length,
    ),
  };
};

/**
 * Where the dialog sends the focus: to a started run's heading if it is shown
 * already, since it could not take the focus behind the dialog. One that comes
 * later takes it then.
 */
export const useStartFocus = () => {
  const started = useRef<string | null>(null);
  return {
    onStarted: (run: string): void => {
      started.current = run;
    },
    finalFocus: (): HTMLElement | true => {
      const run = started.current;
      started.current = null;
      const heading = document.querySelector<HTMLElement>("[data-run-heading]");
      return run !== null && heading?.dataset["runHeading"] === run
        ? heading
        : true;
    },
  };
};

export const useRunForm = (
  onDone: () => void,
  onStarted: (run: string) => void,
) => {
  const state = useAppState();
  const projectsRead = useValue(state.projects.state);
  const projects = useMemo(
    () => (projectsRead.status === "ready" ? projectsRead.data : []),
    [projectsRead],
  );
  const [preset] = useState(() => state.runPreset.getValue());
  const [chosenProject, setChosenProject] = useState<string | null>(
    preset?.project ?? null,
  );
  const [chosenWorkflow, setChosenWorkflow] = useState<string | null>(
    preset?.workflow ?? null,
  );
  const [typed, setTyped] = useState<InputValues>({});
  const [flags, setFlags] = useState<RunFlags>(NO_FLAGS);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const project =
    chosenProject ?? (projects.length === 1 ? (projects[0]?.id ?? null) : null);
  const {
    list: workflows,
    reading: readingWorkflows,
    problem: workflowsTrouble,
  } = useWorkflows(project);
  const named =
    chosenWorkflow ?? (workflows.length === 1 ? workflows[0]?.name : null);
  const workflow = workflows.find(({ name }) => name === named) ?? null;
  const values = useMemo(
    () => ({ ...initialValues(workflow?.inputs ?? {}), ...typed }),
    [workflow, typed],
  );
  const blocked = workflowsTrouble ?? blockedBy(project, workflow, values);

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
      state.arriveAt(answer.data.runId);
      toasts.add({ title: `Run ${answer.data.runId} started` });
      onStarted(answer.data.runId);
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
    readingWorkflows,
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
