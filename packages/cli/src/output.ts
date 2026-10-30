import { styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

/** Styles text for stdout; plain when stdout is not a TTY or NO_COLOR is set. */
export const style = (format: Format, text: string): string =>
  styleText(format, text, { stream: process.stdout });

export const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};
