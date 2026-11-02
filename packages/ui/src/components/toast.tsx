/**
 * @file Toasts, on Base UI's: brief messages in a corner, announced to screen
 *   readers as they appear. `toasts` is the one manager, so code outside React
 *   (the streams) can add one; `Toasts` draws them. F6 jumps into them, and
 *   hovering or focusing them holds their timers.
 */

import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

import { IconClose } from "./icons.tsx";

import styles from "./toast.module.css";

export const toasts = Toast.createToastManager();

const List = () => {
  const { toasts: shown } = Toast.useToastManager();
  return shown.map(toast => (
    <Toast.Root
      className={styles["toast"]}
      key={toast.id}
      toast={toast}
    >
      <Toast.Content className={styles["content"]}>
        <Toast.Title className={styles["title"]} />
        <Toast.Description className={styles["description"]} />
      </Toast.Content>
      <Toast.Close
        aria-label="Dismiss"
        className={styles["close"]}
      >
        <IconClose />
      </Toast.Close>
    </Toast.Root>
  ));
};

export const Toasts = ({ children }: { children?: ReactNode }) => (
  <Toast.Provider toastManager={toasts}>
    {children}
    <Toast.Portal>
      <Toast.Viewport
        aria-label="Messages"
        className={styles["viewport"]}
      >
        <List />
      </Toast.Viewport>
    </Toast.Portal>
  </Toast.Provider>
);
