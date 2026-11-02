/**
 * @file A tooltip: the hover and focus hint on a control, with the CLI command
 *   that does the same thing. A tooltip is visual only, so the control keeps
 *   its own accessible name; `cliDescription` gives screen readers the command.
 *   It opens on hover and on keyboard focus, closes on Escape, and stays open
 *   while the pointer is over it (WCAG 1.4.13).
 */

import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import styles from "./popup.module.css";

const DELAY_MS = 300;

/** The delay every tooltip below it shares, so moving between them is quick. */
export const TipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delay={DELAY_MS}>{children}</Tooltip.Provider>
);

/** The accessible description of a control with a CLI twin. */
export const cliDescription = (
  cli: string | undefined,
): { "aria-description"?: string } =>
  cli === undefined ? {} : { "aria-description": `CLI: ${cli}` };

export type TipProps = {
  /** The control the hint is for: one element that takes a ref and props. */
  children: ReactElement<Record<string, unknown>>;
  /** What the control does, in words. */
  label?: string | undefined;
  /** The CLI command that does the same, such as `ork pause 4f2a1c`. */
  cli?: string | undefined;
};

export const Tip = ({ children, label, cli }: TipProps) => (
  <Tooltip.Root>
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner
        className={styles["tipPositioner"]}
        sideOffset={6}
      >
        <Tooltip.Popup className={styles["tip"]}>
          {label === undefined ? null : <span>{label}</span>}
          {cli === undefined ? null : (
            <code className={styles["tipCommand"]}>{cli}</code>
          )}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);
