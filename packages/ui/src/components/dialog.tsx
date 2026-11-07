/**
 * @file The two modal surfaces, on Base UI's: `Dialog` for a task (the Run
 *   workflow form), and `ConfirmDialog` for an action that needs a second
 *   thought, such as stopping a run. Each traps focus, closes on Escape and
 *   gives focus back. A confirm dialog is an alert dialog: a click outside does
 *   not dismiss it, its description says what the action will do, and focus
 *   starts on Cancel. It can hold a choice the action takes, such as a driver.
 *   One whose action waits for the server stays open until it answers, and
 *   keeps a refusal in it. Each carries `data-modal`, by which the workspace's
 *   keys know to wait (a floating panel is a `dialog` to dockview, but not
 *   modal), and `aria-modal`, since Base UI leaves the page's live regions, and
 *   what holds them, unhidden behind it.
 */

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { type ReactNode, type RefObject, useRef, useState } from "react";

import { Button } from "./button.tsx";
import { CodeText } from "./code-text.tsx";
import { CopyCommand } from "./copy-command.tsx";

import styles from "./dialog.module.css";

type Controlled = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Where the focus goes on closing: an element, back (true), or nowhere. */
export type FinalFocus = () => HTMLElement | boolean;

export type DialogProps = Controlled & {
  title: string;
  description?: string;
  children: ReactNode;
  /** Where the focus goes on closing, if not back where it came from. */
  finalFocus?: FinalFocus;
  /** Where the focus starts, if not on the first thing that takes it. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Wide holds text to read, such as a post's preview. */
  size?: "default" | "wide";
};

const backWhereItCameFrom = (): true => true;

export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  finalFocus = backWhereItCameFrom,
  initialFocus,
  size = "default",
}: DialogProps) => (
  <BaseDialog.Root
    onOpenChange={next => {
      onOpenChange(next);
    }}
    open={open}
  >
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={styles["backdrop"]} />
      <BaseDialog.Popup
        aria-modal="true"
        className={styles["dialog"]}
        data-modal=""
        data-size={size}
        finalFocus={finalFocus}
        initialFocus={initialFocus ?? true}
      >
        <BaseDialog.Title className={styles["title"]}>
          <CodeText text={title} />
        </BaseDialog.Title>
        {description === undefined ? null : (
          <BaseDialog.Description className={styles["description"]}>
            <CodeText text={description} />
          </BaseDialog.Description>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  </BaseDialog.Root>
);

/** A dialog's buttons, in their place at its end. */
export const DialogActions = ({ children }: { children: ReactNode }) => (
  <div className={styles["actions"]}>{children}</div>
);

/** What an action that waits says: nothing when it's done, or its refusal. */
export type Confirmed = Promise<string | null>;

export type ConfirmDialogProps = Controlled & {
  title: string;
  /** What the action will do, in the CLI's words. */
  description: string;
  /** The action, as a verb: "Stop run". */
  confirm: string;
  /**
   * The action. One that returns a promise keeps the dialog open until it
   * settles, and a refusal it resolves to stays in the dialog.
   */
  onConfirm: () => void | Confirmed;
  /** The confirm button's words while it waits: "Starting…". */
  pending?: string | undefined;
  /** Danger for what can't be undone; primary for a cost, such as a run. */
  variant?: "danger" | "primary";
  /**
   * The CLI command that does the same, shown in the dialog as a code block: a
   * tooltip here would cover the description, and Escape would close it, not
   * the dialog.
   */
  cli?: string | undefined;
  finalFocus?: FinalFocus;
  /** A choice the action takes, such as a driver, above its command. */
  children?: ReactNode;
};

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  pending,
  variant = "danger",
  cli,
  finalFocus = backWhereItCameFrom,
  children,
}: ConfirmDialogProps) => {
  const [waiting, setWaiting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Named, since the command block's copy button comes first: Escape there
  // would close its tooltip, not the dialog.
  const cancel = useRef<HTMLButtonElement>(null);
  const run = async (): Promise<void> => {
    const done = onConfirm();
    if (done === undefined) {
      onOpenChange(false);
      return;
    }
    setWaiting(true);
    setRefusal(null);
    const refused = await done;
    setWaiting(false);
    setRefusal(refused);
    if (refused === null) onOpenChange(false);
  };
  return (
    <AlertDialog.Root
      onOpenChange={next => {
        // Closing while it waits would hide how it ended.
        if (waiting) return;
        if (!next) setRefusal(null);
        onOpenChange(next);
      }}
      open={open}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={styles["backdrop"]} />
        <AlertDialog.Popup
          aria-modal="true"
          className={styles["dialog"]}
          data-modal=""
          finalFocus={finalFocus}
          initialFocus={cancel}
        >
          <AlertDialog.Title className={styles["title"]}>
            <CodeText text={title} />
          </AlertDialog.Title>
          <AlertDialog.Description className={styles["description"]}>
            <CodeText text={description} />
          </AlertDialog.Description>
          {children}
          {cli === undefined ? null : <CopyCommand command={cli} />}
          {refusal === null ? null : (
            <p
              className={styles["refusal"]}
              role="alert"
            >
              <CodeText text={refusal} />
            </p>
          )}
          <div className={styles["actions"]}>
            <AlertDialog.Close
              disabled={waiting}
              ref={cancel}
              render={<Button focusableWhenDisabled>Cancel</Button>}
            />
            <Button
              disabled={waiting}
              focusableWhenDisabled
              onClick={() => {
                void run();
              }}
              variant={variant}
            >
              {waiting ? (pending ?? confirm) : confirm}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};
