/**
 * @file A select, on Base UI's: one choice from a short list. For a list long
 *   enough to need filtering, use the combobox.
 */

import { Select as BaseSelect } from "@base-ui/react/select";

import { IconCheck, IconChevronDown } from "./icons.tsx";
import { Unseen } from "./unseen.tsx";

import fields from "./field.module.css";
import styles from "./popup.module.css";

export type Option = { value: string; label: string };

export type SelectProps = {
  label: string;
  /** More of the label's words, for a screen reader only. */
  unseen?: string | undefined;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  /** The id of what says more about the choice, read out with it. */
  describedBy?: string | undefined;
};

export const Select = ({
  label,
  unseen,
  options,
  value,
  onChange,
  describedBy,
}: SelectProps) => (
  <BaseSelect.Root
    items={options}
    onValueChange={next => {
      if (next !== null) onChange(next);
    }}
    value={value}
  >
    <div className={fields["field"]}>
      <BaseSelect.Label className={fields["label"]}>
        {label}
        {unseen === undefined ? null : <Unseen>{unseen}</Unseen>}
      </BaseSelect.Label>
      <BaseSelect.Trigger
        aria-describedby={describedBy}
        className={fields["control"]}
      >
        <BaseSelect.Value />
        <BaseSelect.Icon className={fields["icon"]}>
          <IconChevronDown />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
    </div>
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align="start"
        alignItemWithTrigger={false}
        className={styles["positioner"]}
        sideOffset={4}
      >
        <BaseSelect.Popup className={styles["popup"]}>
          <BaseSelect.List aria-label={label}>
            {options.map(option => (
              <BaseSelect.Item
                className={styles["item"]}
                key={option.value}
                value={option.value}
              >
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className={fields["icon"]}>
                  <IconCheck />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  </BaseSelect.Root>
);
