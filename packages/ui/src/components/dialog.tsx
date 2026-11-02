/**
 * @file The two modal surfaces, on Base UI's: `Dialog` for a task (the Run
 *   workflow form), and `ConfirmDialog` for an action that needs a second
 *   thought, such as stopping a run. Each traps focus, closes on Escape and
 *   gives focus back. A confirm dialog is an alert dialog: a click outside does
 *   not dismiss it, its description says what the action will do, and focus
 *   starts on Cancel.
 */

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

import { Button } from "./button.tsx";

import styles from "./dialog.module.css";

type Controlled = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export type DialogProps = Controlled & {
  title: string;
  description?: string;
  children: ReactNode;
};

export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
}: DialogProps) => (
  <BaseDialog.Root
    onOpenChange={next => {
      onOpenChange(next);
    }}
    open={open}
  >
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={styles["backdrop"]} />
      <BaseDialog.Popup className={styles["dialog"]}>
        <BaseDialog.Title className={styles["title"]}>{title}</BaseDialog.Title>
        {description === undefined ? null : (
          <BaseDialog.Description className={styles["description"]}>
            {description}
          </BaseDialog.Description>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  </BaseDialog.Root>
);

export type ConfirmDialogProps = Controlled & {
  title: string;
  /** What the action will do, in the CLI's words. */
  description: string;
  /** The action, as a verb: "Stop run". */
  confirm: string;
  onConfirm: () => void;
  /**
   * The CLI command that does the same, shown in the dialog: a tooltip here
   * would cover the description, and Escape would close it, not the dialog.
   */
  cli?: string | undefined;
};

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  cli,
}: ConfirmDialogProps) => (
  <AlertDialog.Root
    onOpenChange={next => {
      onOpenChange(next);
    }}
    open={open}
  >
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className={styles["backdrop"]} />
      <AlertDialog.Popup className={styles["dialog"]}>
        <AlertDialog.Title className={styles["title"]}>
          {title}
        </AlertDialog.Title>
        <AlertDialog.Description className={styles["description"]}>
          {description}
        </AlertDialog.Description>
        {cli === undefined ? null : (
          <code className={styles["command"]}>{cli}</code>
        )}
        <div className={styles["actions"]}>
          <AlertDialog.Close render={<Button>Cancel</Button>} />
          <AlertDialog.Close
            render={
              <Button
                onClick={onConfirm}
                variant="danger"
              >
                {confirm}
              </Button>
            }
          />
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
