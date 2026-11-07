/**
 * @file The copy-command block, the UI's one code block: a CLI command in
 *   monospace, the whole width of its place, with a button in its top-right
 *   corner that copies it and a status that says whether it did. The status is
 *   a live region, so a screen reader hears it too. Every command the UI shows
 *   is one of these, never inline code
 *   (specs/ui/design-components-and-copy.md#copy).
 */

import { CopyButton } from "./copy-button.tsx";

import styles from "./copy-command.module.css";

export const CopyCommand = ({ command }: { command: string }) => (
  <div className={styles["field"]}>
    <code className={styles["command"]}>{command}</code>
    <span className={styles["copy"]}>
      <CopyButton
        label={`Copy ${command}`}
        resultClass={styles["result"]}
        text={command}
      />
    </span>
  </div>
);
