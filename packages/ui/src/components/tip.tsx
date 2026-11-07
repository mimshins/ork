/**
 * @file A tooltip: the hover and focus hint on a control, with the CLI command
 *   that does the same thing on its own line under the words, as a code block
 *   with no copy button, since a tip can't be clicked into. A tooltip is visual
 *   only, so the control keeps its own accessible name; `cliDescription` gives
 *   screen readers the command. It opens on hover and on keyboard focus, closes
 *   on Escape, and stays open while the pointer is over it (WCAG 1.4.13).
 */

import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { CodeText } from "./code-text.tsx";
import { Kbd } from "./kbd.tsx";

import styles from "./popup.module.css";

const DELAY_MS = 300;

/** The delay every tooltip below it shares, so moving between them is quick. */
export const TipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delay={DELAY_MS}>{children}</Tooltip.Provider>
);

/** The accessible description of a control with a CLI twin. */
export const cliDescription = (
  cli: string | undefined,
  /** What else to say of the control, before the command. */
  before?: string,
): { "aria-description"?: string } => {
  const parts = [before, cli === undefined ? undefined : `CLI: ${cli}`].filter(
    part => part !== undefined,
  );
  return parts.length === 0 ? {} : { "aria-description": parts.join(". ") };
};

export type TipProps = {
  /** The control the hint is for: one element that takes a ref and props. */
  children: ReactElement<Record<string, unknown>>;
  /** What the control does, in words. */
  label?: string | undefined;
  /** The CLI command that does the same, such as `ork pause 4f2a1c`. */
  cli?: string | undefined;
  /** The keys that do the same, one entry per key. */
  keys?: readonly string[] | undefined;
};

export const Tip = ({ children, label, cli, keys }: TipProps) => (
  <Tooltip.Root>
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner
        className={styles["tipPositioner"]}
        sideOffset={6}
      >
        <Tooltip.Popup className={styles["tip"]}>
          {label === undefined ? null : (
            <span>
              <CodeText text={label} />
            </span>
          )}
          {cli === undefined ? null : (
            <code className={styles["tipCommand"]}>{cli}</code>
          )}
          {keys === undefined ? null : <Kbd keys={keys} />}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>
);
