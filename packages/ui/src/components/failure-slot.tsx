/**
 * @file Where a dialog's read or act that failed says so, with the way to try
 *   it again. It's always there, so a failure fills its line rather than moving
 *   the dialog, and its alert is heard. A failed act can take the focus to Try
 *   again, since the act's own button may not be pressable; a failed read does
 *   only if the focus was lost. The publish dialog and the Worktrees panel's
 *   dialogs share it.
 */

import { useEffect, useRef } from "react";

import { Button } from "./button.tsx";
import { CodeText } from "./code-text.tsx";

import styles from "./failure-slot.module.css";

export const FailureSlot = ({
  id,
  words,
  takeFocus,
  onTryAgain,
}: {
  id: string;
  words: string | null;
  takeFocus: "always" | "ifLost";
  /** Without one there's no Try again: the next step is something else. */
  onTryAgain?: (() => void) | undefined;
}) => {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (words === null) return;
    const active = document.activeElement;
    const lost =
      active === null ||
      active === document.body ||
      active.getAttribute("aria-disabled") === "true";
    if (takeFocus === "always" || lost) {
      slot.current?.querySelector("button")?.focus();
    }
  }, [words, takeFocus]);
  return (
    <div
      className={styles["slot"]}
      ref={slot}
    >
      <p
        className={styles["alert"]}
        id={id}
        role="alert"
      >
        {words === null ? null : <CodeText text={words} />}
      </p>
      {words === null || onTryAgain === undefined ? null : (
        <Button
          onClick={onTryAgain}
          variant="ghost"
        >
          Try again
        </Button>
      )}
    </div>
  );
};
