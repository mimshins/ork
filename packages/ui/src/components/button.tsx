/**
 * @file The button and the icon button, on Base UI's. A button says what it
 *   does in words. An icon button takes a required `label`, which is its
 *   accessible name and its tooltip. Either can name its CLI twin (`cli`),
 *   shown on hover and on focus and read out as its description; a button's
 *   tooltip can say more (`tip`), such as why it's disabled.
 */

import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentProps, ReactNode } from "react";

import { cliDescription, Tip } from "./tip.tsx";

import styles from "./button.module.css";

type BaseProps = Omit<ComponentProps<typeof BaseButton>, "className" | "style">;

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

export type ButtonProps = BaseProps & {
  variant?: ButtonVariant;
  /** The CLI command that does the same, such as `ork pause 4f2a1c`. */
  cli?: string | undefined;
  /** Words for its tooltip, above the command: why it's disabled. */
  tip?: string | undefined;
};

export const Button = ({
  variant = "default",
  cli,
  tip,
  ...rest
}: ButtonProps) => {
  const button = (
    <BaseButton
      {...rest}
      {...cliDescription(cli)}
      className={styles["button"]}
      data-variant={variant}
    />
  );
  return cli === undefined && tip === undefined ? (
    button
  ) : (
    <Tip
      cli={cli}
      label={tip}
    >
      {button}
    </Tip>
  );
};

export type IconButtonProps = Omit<BaseProps, "children"> & {
  /** What it does, in words: its accessible name and its tooltip. */
  label: string;
  /** The icon. */
  children: ReactNode;
  variant?: ButtonVariant;
  cli?: string | undefined;
  /** The keys that do the same, shown in its tooltip. */
  keys?: readonly string[] | undefined;
};

export const IconButton = ({
  label,
  variant = "ghost",
  cli,
  keys,
  ...rest
}: IconButtonProps) => (
  <Tip
    cli={cli}
    keys={keys}
    label={label}
  >
    <BaseButton
      {...rest}
      {...cliDescription(cli)}
      aria-label={label}
      className={styles["icon"]}
      data-variant={variant}
    />
  </Tip>
);
