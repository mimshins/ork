/**
 * @file The copy-command field: a CLI command in monospace with a button that
 *   copies it, and a status that says whether it did. The status is a live
 *   region, so a screen reader hears it too.
 */

import { useState } from "react";

import { IconButton } from "./button.tsx";
import { IconCopy } from "./icons.tsx";

import styles from "./copy-command.module.css";

type Result = "" | "Copied." | "Copy failed: select the text instead.";

export const CopyCommand = ({ command }: { command: string }) => {
  const [result, setResult] = useState<Result>("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setResult("Copied.");
    } catch {
      setResult("Copy failed: select the text instead.");
    }
  };
  return (
    <div className={styles["field"]}>
      <code className={styles["command"]}>{command}</code>
      <IconButton
        label={`Copy ${command}`}
        onClick={() => {
          void copy();
        }}
      >
        <IconCopy />
      </IconButton>
      <output className={styles["result"]}>{result}</output>
    </div>
  );
};
