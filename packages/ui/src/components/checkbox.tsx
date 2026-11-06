/**
 * @file A checkbox and a switch, on Base UI's, each inside its own label: the
 *   whole row is the target, and the label is its accessible name. A checkbox
 *   chooses; a switch turns something on at once.
 */

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Switch as BaseSwitch } from "@base-ui/react/switch";

import { IconCheck } from "./icons.tsx";

import styles from "./field.module.css";

export type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** The id of what says more about it, read out with it. */
  describedBy?: string | undefined;
};

export const Checkbox = ({
  label,
  checked,
  onChange,
  disabled = false,
  describedBy,
}: ToggleProps) => (
  <label className={styles["toggle"]}>
    <BaseCheckbox.Root
      aria-describedby={describedBy}
      checked={checked}
      className={styles["box"]}
      disabled={disabled}
      onCheckedChange={next => {
        onChange(next);
      }}
    >
      <BaseCheckbox.Indicator className={styles["mark"]}>
        <IconCheck />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
    {label}
  </label>
);

export const Switch = ({
  label,
  checked,
  onChange,
  disabled = false,
}: ToggleProps) => (
  <label className={styles["toggle"]}>
    <BaseSwitch.Root
      checked={checked}
      className={styles["switch"]}
      disabled={disabled}
      onCheckedChange={next => {
        onChange(next);
      }}
    >
      <BaseSwitch.Thumb className={styles["thumb"]} />
    </BaseSwitch.Root>
    {label}
  </label>
);
