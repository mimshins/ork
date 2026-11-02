/**
 * @file A menu of actions, on Base UI's: a list of entries behind a trigger
 *   button, with the arrow keys, typeahead, Escape and focus return Base UI
 *   gives it. An entry is an action or a separator.
 */

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement } from "react";

import styles from "./popup.module.css";

export type MenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** It destroys something or stops something: drawn in the danger color. */
  danger?: boolean;
  /** A key hint shown at its end. */
  hint?: string;
};

export type MenuEntry = MenuAction | "separator";

export type MenuProps = {
  /** The button that opens it. */
  trigger: ReactElement<Record<string, unknown>>;
  entries: readonly MenuEntry[];
};

const entryKey = (entry: MenuEntry, index: number): string =>
  entry === "separator" ? `separator-${String(index)}` : entry.label;

const Entry = ({ entry }: { entry: MenuEntry }) => {
  if (entry === "separator") {
    return <BaseMenu.Separator className={styles["separator"]} />;
  }
  return (
    <BaseMenu.Item
      className={styles["item"]}
      data-variant={entry.danger === true ? "danger" : "default"}
      disabled={entry.disabled ?? false}
      onClick={entry.onSelect}
    >
      <span>{entry.label}</span>
      {entry.hint === undefined ? null : <kbd>{entry.hint}</kbd>}
    </BaseMenu.Item>
  );
};

export const Menu = ({ trigger, entries }: MenuProps) => (
  <BaseMenu.Root>
    <BaseMenu.Trigger render={trigger} />
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align="start"
        className={styles["positioner"]}
        sideOffset={4}
      >
        <BaseMenu.Popup className={styles["popup"]}>
          {entries.map((entry, index) => (
            <Entry
              entry={entry}
              key={entryKey(entry, index)}
            />
          ))}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  </BaseMenu.Root>
);
