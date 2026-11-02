/**
 * @file A combobox, on Base UI's: one choice from a list long enough to filter,
 *   such as projects and workflows. Typing filters the list; the arrow keys
 *   move through it while focus stays in the input, and an empty result says
 *   so.
 */

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { useId } from "react";

import { IconCheck, IconChevronDown } from "./icons.tsx";
import type { Option } from "./select.tsx";

import fields from "./field.module.css";
import styles from "./popup.module.css";

export type ComboboxProps = {
  label: string;
  options: readonly Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Says what the input takes while nothing is chosen. */
  placeholder?: string;
  /** What an empty result says: "No workflow matches." */
  empty: string;
};

const labelOf = (option: Option): string => option.label;
const sameOption = (a: Option, b: Option): boolean => a.value === b.value;

export const Combobox = ({
  label,
  options,
  value,
  onChange,
  placeholder = "",
  empty,
}: ComboboxProps) => {
  const inputId = useId();
  return (
    <BaseCombobox.Root
      isItemEqualToValue={sameOption}
      itemToStringLabel={labelOf}
      items={options}
      onValueChange={next => {
        onChange(next?.value ?? null);
      }}
      value={options.find(option => option.value === value) ?? null}
    >
      <div className={fields["field"]}>
        <label
          className={fields["label"]}
          htmlFor={inputId}
        >
          {label}
        </label>
        <BaseCombobox.InputGroup className={fields["group"]}>
          <BaseCombobox.Input
            className={fields["input"]}
            id={inputId}
            placeholder={placeholder}
          />
          <BaseCombobox.Trigger
            aria-label={`Show ${label} list`}
            className={fields["inputButton"]}
          >
            <IconChevronDown />
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>
      </div>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          align="start"
          className={styles["positioner"]}
          sideOffset={4}
        >
          <BaseCombobox.Popup className={styles["popup"]}>
            <BaseCombobox.Empty className={fields["empty"]}>
              {empty}
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(option: Option) => (
                <BaseCombobox.Item
                  className={styles["item"]}
                  key={option.value}
                  value={option}
                >
                  <span>{option.label}</span>
                  <BaseCombobox.ItemIndicator className={fields["icon"]}>
                    <IconCheck />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
};
