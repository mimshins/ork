/**
 * @file The Run workflow form's fields that depend on the workflow and the CLI:
 *   one per declared input, by its type, the run flags in the CLI's words, and
 *   what it says with no project to run in.
 */

import type { WorkflowView } from "@krapht/ork-server/client";

import { EmptyState } from "../components/bits.tsx";
import { Checkbox } from "../components/checkbox.tsx";
import { CodeText } from "../components/code-text.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import type { DriverChoice, InputValues, RunFlags } from "./run-form.ts";

import styles from "./runs.module.css";

const DRIVERS: readonly { value: DriverChoice; label: string }[] = [
  { value: "", label: "The workflow's default" },
  { value: "sdk", label: "sdk: API key or cloud provider" },
  { value: "cli", label: "cli: your claude login" },
];

export const InputFields = ({
  workflow,
  values,
  onChange,
}: {
  workflow: WorkflowView;
  values: InputValues;
  onChange: (name: string, value: string) => void;
}) => (
  <>
    {Object.entries(workflow.inputs).map(([name, def]) =>
      def.type === "boolean" ? (
        <Checkbox
          checked={values[name] === "true"}
          key={name}
          label={name}
          onChange={checked => {
            onChange(name, String(checked));
          }}
        />
      ) : (
        <TextField
          description={def.description}
          key={name}
          label={name}
          onChange={value => {
            onChange(name, value);
          }}
          required={def.required === true}
          type={def.type === "number" ? "number" : "text"}
          value={values[name] ?? ""}
        />
      ),
    )}
  </>
);

export const FlagFields = ({
  flags,
  onChange,
}: {
  flags: RunFlags;
  onChange: (change: Partial<RunFlags>) => void;
}) => (
  <fieldset className={styles["group"]}>
    <legend className={styles["legend"]}>Flags</legend>
    <Select
      label="Driver"
      onChange={next => {
        const driver = DRIVERS.find(option => option.value === next);
        if (driver !== undefined) onChange({ driver: driver.value });
      }}
      options={DRIVERS}
      value={flags.driver}
    />
    <Checkbox
      checked={flags.inPlace}
      label="--in-place: run worktree nodes in this checkout"
      onChange={inPlace => {
        onChange({ inPlace });
      }}
    />
    <Checkbox
      checked={flags.allowDirty}
      label="--allow-dirty: run with uncommitted instructions or skills"
      onChange={allowDirty => {
        onChange({ allowDirty });
      }}
    />
  </fieldset>
);

/** The form has nothing to run without a project; this says how to get one. */
export const NoProjects = () => (
  <EmptyState
    cli="ork init"
    title="No projects yet."
  >
    Run this in a repository:
  </EmptyState>
);

/** Why a run can't start, or the form can't show. */
export const RunError = ({ error }: { error: string }) => (
  <p
    className={styles["error"]}
    role="alert"
  >
    <CodeText text={error} />
  </p>
);
