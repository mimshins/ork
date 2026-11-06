/**
 * @file The copy-command field: a CLI command in monospace with a button that
 *   copies it, and a status that says whether it did. The status is a live
 *   region, so a screen reader hears it too.
 */

import { CopyButton } from "./copy-button.tsx";

import styles from "./copy-command.module.css";

export const CopyCommand = ({ command }: { command: string }) => (
  <div className={styles["field"]}>
    <code className={styles["command"]}>{command}</code>
    <CopyButton
      label={`Copy ${command}`}
      resultClass={styles["result"]}
      text={command}
    />
  </div>
);
