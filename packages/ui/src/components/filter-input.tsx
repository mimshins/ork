/**
 * @file The filter bar's text control: free text with suggestions, on Base UI's
 *   Autocomplete (a Combobox only picks). Suggestions help and never limit;
 *   typing is a draft, applied when the bar says so (Enter, leaving the field,
 *   or choosing a suggestion). Escape with the list closed takes the draft
 *   back.
 */

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useId, useRef } from "react";

import { IconChevronDown } from "./icons.tsx";

import fields from "./field.module.css";
import styles from "./popup.module.css";

/** A suggestion: `value` is what is applied, `label` what shows. */
export type Suggestion = { value: string; label: string };

export type FilterInputProps = {
  label: string;
  placeholder: string;
  /** The ids of what says more about the field, read out with it. */
  describedBy: string;
  invalid: boolean;
  suggestions: readonly Suggestion[];
  /** What the input shows: the draft, else the applied value. */
  text: string;
  onText: (text: string) => void;
  /** Apply a text: Enter, leaving the field, or choosing a suggestion. */
  onCommit: (text: string) => void;
  /** Drop the draft. */
  onRestore: () => void;
};

const valueOf = (item: Suggestion): string => item.value;

export const FilterInput = ({
  label,
  placeholder,
  describedBy,
  invalid,
  suggestions,
  text,
  onText,
  onCommit,
  onRestore,
}: FilterInputProps) => {
  const inputId = useId();
  const highlighted = useRef(false);
  const open = useRef(false);
  return (
    <Autocomplete.Root
      items={suggestions}
      itemToStringValue={valueOf}
      onItemHighlighted={item => {
        highlighted.current = item !== undefined;
      }}
      onOpenChange={next => {
        open.current = next;
      }}
      onValueChange={(next, details) => {
        // Base clears the input on Escape; the draft goes back to the applied value instead.
        if (details.reason === "item-press") {
          onText(next);
          onCommit(next);
        } else if (details.reason === "input-change") {
          onText(next);
        }
      }}
      value={text}
    >
      <div className={fields["field"]}>
        <label
          className={fields["label"]}
          htmlFor={inputId}
        >
          {label}
        </label>
        <Autocomplete.InputGroup
          className={fields["group"]}
          data-invalid={invalid ? "" : undefined}
        >
          <Autocomplete.Input
            aria-describedby={describedBy}
            aria-invalid={invalid ? true : undefined}
            aria-label={label}
            className={fields["input"]}
            id={inputId}
            onBlur={() => {
              onCommit(text);
            }}
            onKeyDown={event => {
              if (event.key === "Enter" && !highlighted.current) onCommit(text);
              if (event.key === "Escape" && !open.current) onRestore();
            }}
            placeholder={placeholder}
          />
          <Autocomplete.Trigger
            aria-label={`Show ${label} suggestions`}
            className={fields["inputButton"]}
          >
            <IconChevronDown />
          </Autocomplete.Trigger>
        </Autocomplete.InputGroup>
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          align="start"
          className={styles["positioner"]}
          sideOffset={4}
        >
          <Autocomplete.Popup className={styles["popup"]}>
            <Autocomplete.List aria-label={`${label} suggestions`}>
              {(item: Suggestion) => (
                <Autocomplete.Item
                  className={styles["item"]}
                  key={item.value}
                  value={item}
                >
                  {item.label}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
};
