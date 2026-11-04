/**
 * @file Choosing what to build: a project, one of its workflows or unsaved
 *   drafts, or a new name.
 */

import { useEffect, useState } from "react";
import { useValue } from "react-containerized-state";

import { Button } from "../components/button.tsx";
import { Combobox } from "../components/combobox.tsx";
import { TextField } from "../components/text-field.tsx";
import { useAppState } from "../state/context.tsx";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

export const Chooser = ({ builder }: { builder: Builder }) => {
  const state = useAppState();
  const projectsRead = useValue(state.projects.state);
  const workflowsRead = useValue(state.workflows.state);
  const projects = projectsRead.status === "ready" ? projectsRead.data : [];
  const [project, setProject] = useState<string | null>(null);
  const [naming, setNaming] = useState("");
  const here =
    project ?? (projects.length === 1 ? projects[0]?.id : null) ?? null;
  const { chooseProject } = builder;
  useEffect(() => {
    void state.projects.load();
  }, [state]);
  useEffect(() => {
    if (here !== null) {
      void state.workflows.load(here);
      chooseProject(here);
    }
  }, [state, here, chooseProject]);
  const onDisk =
    workflowsRead.status === "ready" && workflowsRead.arg === here
      ? workflowsRead.data.map(({ name }) => name)
      : [];
  const names = [...new Set([...onDisk, ...builder.drafts])].toSorted();
  const create = async (): Promise<void> => {
    if (here === null || naming === "") return;
    if (await builder.create(here, naming)) setNaming("");
  };
  return (
    <div className={styles["chooser"]}>
      <Combobox
        empty="No project matches."
        label="Project"
        onChange={setProject}
        options={projects.map(({ id }) => ({ value: id, label: id }))}
        placeholder="Type to find a project"
        value={here}
      />
      <Combobox
        disabled={here === null || names.length === 0}
        empty="No workflow matches."
        label="Workflow"
        onChange={name => {
          if (here !== null && name !== null) void builder.open(here, name);
        }}
        options={names.map(name => ({
          value: name,
          label: builder.drafts.includes(name) ? `${name} (draft)` : name,
        }))}
        placeholder={names.length === 0 ? "None yet" : "Type to find one"}
        value={builder.opened?.name ?? null}
      />
      <form
        className={styles["create"]}
        onSubmit={event => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField
          label="New workflow"
          onChange={setNaming}
          value={naming}
        />
        <Button
          disabled={here === null || naming === ""}
          focusableWhenDisabled
          type="submit"
        >
          Create
        </Button>
      </form>
    </div>
  );
};
