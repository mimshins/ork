/**
 * @file A popover, on Base UI's: a small panel anchored to a trigger, with a
 *   title that names it. Focus moves in when it opens and back when it closes.
 */

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

import styles from "./popup.module.css";

export type PopoverProps = {
  /** The button that opens it. */
  trigger: ReactElement<Record<string, unknown>>;
  title: string;
  children: ReactNode;
};

export const Popover = ({ trigger, title, children }: PopoverProps) => (
  <BasePopover.Root>
    <BasePopover.Trigger render={trigger} />
    <BasePopover.Portal>
      <BasePopover.Positioner
        className={styles["positioner"]}
        sideOffset={4}
      >
        <BasePopover.Popup className={styles["panel"]}>
          <BasePopover.Title className={styles["title"]}>
            {title}
          </BasePopover.Title>
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  </BasePopover.Root>
);
