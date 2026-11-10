/**
 * @file The Run workflow form's fields that depend on the workflow and the CLI:
 *   one per declared input, by its type, the run flags in the CLI's words (the
 *   driver's field is Propose fix's too), the switch to this machine's Claude
 *   setup, and what it says with no project to run in.
 */

import { DRIVER_CHOICES, type WorkflowView } from "@krapht/ork-server/client";
import { useId } from "react";

import { EmptyState } from "../components/bits.tsx";
import { Checkbox } from "../components/checkbox.tsx";
import { CodeText } from "../components/code-text.tsx";
import { Select } from "../components/select.tsx";
import { TextField } from "../components/text-field.tsx";
import type { DriverChoice, InputValues, RunFlags } from "./run-form.ts";

import fields from "../components/field.module.css";
import styles from "./runs.module.css";

const DRIVERS: readonly { value: DriverChoice; label: string }[] = [
  { value: "", label: "The workflow's, else the one ready" },
  ...DRIVER_CHOICES.map(id => ({ value: id, label: id })),
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

/**
 * Which driver a run takes: `--driver`, or what the workflow names, else the
 * one ready on this machine when it starts.
 */
export const DriverField = ({
  value,
  onChange,
}: {
  value: DriverChoice;
  onChange: (driver: DriverChoice) => void;
}) => (
  <Select
    label="Driver"
    onChange={next => {
      const driver = DRIVERS.find(option => option.value === next);
      if (driver !== undefined) onChange(driver.value);
    }}
    options={DRIVERS}
    value={value}
  />
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
    <DriverField
      onChange={driver => {
        onChange({ driver });
      }}
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
    <MachineClaudeBox
      checked={flags.machineClaude}
      onChange={machineClaude => {
        onChange({ machineClaude });
      }}
    />
  </fieldset>
);

const MACHINE_CLAUDE_HINT = "Your MCP servers and Claude's memory";

/**
 * `--machine-claude`: off by default, so the run's sessions start clean of this
 * machine's MCP servers and Claude's memory (ADR-065).
 */
const MachineClaudeBox = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  const hintId = useId();
  return (
    <>
      <Checkbox
        checked={checked}
        describedBy={hintId}
        label="Use this machine's Claude setup"
        onChange={onChange}
      />
      <p
        className={fields["hint"]}
        id={hintId}
      >
        {MACHINE_CLAUDE_HINT}
      </p>
    </>
  );
};

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
