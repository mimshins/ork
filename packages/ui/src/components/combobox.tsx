/**
 * @file A combobox, on Base UI's: one choice from a list long enough to filter,
 *   such as projects and workflows. Typing filters the list and highlights its
 *   first match, for Enter to take; an emptied input highlights nothing, and
 *   Enter there clears the choice, as the person meant. The arrow keys move
 *   through the list while focus stays in the input, and an empty result says
 *   so. The input and the list are named as well as labelled, since an open
 *   list hides the label from a screen reader.
 */

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { useId, useState } from "react";

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
  /** Nothing to choose from yet; the placeholder should say why. */
  disabled?: boolean;
  /** The id of what says more about the choice, read out with it. */
  describedBy?: string | undefined;
  /** The choice is refused: it says so with `aria-invalid` and its border. */
  invalid?: boolean | undefined;
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
  disabled = false,
  describedBy,
  invalid = false,
}: ComboboxProps) => {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <BaseCombobox.Root
      autoHighlight={typed.trim() !== ""}
      disabled={disabled}
      isItemEqualToValue={sameOption}
      itemToStringLabel={labelOf}
      items={options}
      onInputValueChange={setTyped}
      onOpenChange={setOpen}
      open={open}
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
        <BaseCombobox.InputGroup
          className={fields["group"]}
          data-invalid={invalid ? "" : undefined}
        >
          <BaseCombobox.Input
            aria-describedby={describedBy}
            aria-invalid={invalid ? true : undefined}
            aria-label={label}
            className={fields["input"]}
            id={inputId}
            onKeyDown={event => {
              const input = event.currentTarget;
              if (event.key === "Enter" && input.value.trim() === "") {
                // Not the highlighted suggestion: an empty field means none.
                event.preventBaseUIHandler();
                event.preventDefault();
                setOpen(false);
                onChange(null);
              }
            }}
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
            <BaseCombobox.List aria-label={label}>
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
