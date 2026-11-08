/**
 * @file The copy-command block, the UI's one code block: a CLI command in
 *   monospace, the whole width of its place, with a button in its top-right
 *   corner that copies it and a status that says whether it did. The status is
 *   a live region, so a screen reader hears it too. Every command the UI shows
 *   is one of these, never inline code
 *   (specs/ui/design-components-and-copy.md#copy). It also draws a code block
 *   of a decision's text: a `caption` (a fence's language) sits at the top-left
 *   on the button's row, and a `label` names the button when "Copy" and the
 *   whole text would be too long or the same as another's.
 */

import { CopyButton } from "./copy-button.tsx";

import styles from "./copy-command.module.css";

export type CopyCommandProps = {
  command: string;
  /** The button's name, if not "Copy" and the command. */
  label?: string | undefined;
  /** A word above the text at its start, such as a fence's language. */
  caption?: string | undefined;
};

export const CopyCommand = ({ command, label, caption }: CopyCommandProps) => (
  <div className={styles["field"]}>
    <div className={styles["body"]}>
      {caption === undefined ? null : (
        <span className={styles["caption"]}>{caption}</span>
      )}
      <code className={styles["command"]}>{command}</code>
    </div>
    <span className={styles["copy"]}>
      <CopyButton
        label={label ?? `Copy ${command}`}
        resultClass={styles["result"]}
        text={command}
      />
    </span>
  </div>
);
