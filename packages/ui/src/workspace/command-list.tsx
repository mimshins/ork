/**
 * @file The palette's search: one input over the commands, grouped. Type to
 *   filter, arrows to pick, Enter to run. A command that cannot run shows why.
 */

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useMemo } from "react";

import { Kbd } from "../components/bits.tsx";
import { type Command, COMMAND_GROUPS, type CommandGroup } from "./commands.ts";
import { platformIsMac } from "./keys.ts";
import { keysOf } from "./shortcuts.ts";

import popup from "../components/popup.module.css";
import styles from "./palette.module.css";

type Item = { label: string; command: Command };
type Section = { value: CommandGroup; items: Item[] };

const sectionsOf = (commands: readonly Command[]): Section[] =>
  COMMAND_GROUPS.map(value => ({
    value,
    items: commands
      .filter(command => command.group === value)
      .map(command => ({ label: command.title, command })),
  }));

export const CommandList = ({
  commands,
  onChoose,
}: {
  commands: readonly Command[];
  onChoose: (command: Command) => void;
}) => {
  const sections = useMemo(() => sectionsOf(commands), [commands]);
  const mac = platformIsMac();
  return (
    <Autocomplete.Root
      autoHighlight="always"
      inline
      items={sections}
      keepHighlight
      open
    >
      <Autocomplete.Input
        aria-label="Search commands"
        className={styles["input"]}
        placeholder="Type a command"
      />
      <Autocomplete.Empty>
        <p className={styles["empty"]}>No command matches.</p>
      </Autocomplete.Empty>
      <Autocomplete.List className={styles["list"]}>
        {(section: Section) => (
          <Autocomplete.Group
            items={section.items}
            key={section.value}
          >
            <Autocomplete.GroupLabel className={styles["group"]}>
              {section.value}
            </Autocomplete.GroupLabel>
            <Autocomplete.Collection>
              {(item: Item) => (
                <Autocomplete.Item
                  className={popup["item"]}
                  disabled={item.command.disabled !== undefined}
                  key={item.command.id}
                  onClick={() => {
                    onChoose(item.command);
                  }}
                  value={item}
                >
                  <span>{item.label}</span>
                  {item.command.disabled === undefined ? null : (
                    <span className={popup["itemDetail"]}>
                      {item.command.disabled}
                    </span>
                  )}
                  {item.command.shortcut === undefined ? null : (
                    <Kbd keys={keysOf(item.command.shortcut, mac)} />
                  )}
                </Autocomplete.Item>
              )}
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>
    </Autocomplete.Root>
  );
};
