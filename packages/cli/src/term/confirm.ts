/**
 * @file The yes-or-no prompt: on a terminal, `Yes` and `No` that ←/→ (or `h`
 *   `l`, Space) move between, `y` and `n` answer at once, Enter takes the one
 *   shown, and Esc is no; it collapses to one line. Plain mode asks `question
 *   [y/N] ` and reads a line: anything but yes is no (the default, for an empty
 *   line), and a closed input is no.
 */

import { readKeys } from "./keys.ts";
import { cut, hang } from "./layout.ts";
import { interrupt, readLine, withdrawn } from "./line.ts";
import { canKey, type PromptIO, termOf } from "./mode.ts";
import { createRegion } from "./screen.ts";
import { apply, bold, paint } from "./theme.ts";

export type ConfirmOptions = {
  /** What is asked, without the `[y/N]`: `Allow Bash rm -rf dist?`. */
  question: string;
  /** What Enter on an empty line, or on the shown choice, answers; no. */
  default?: boolean;
  /** A withdrawn prompt rejects with the signal's reason. */
  signal?: AbortSignal;
};

/**
 * Asks a yes-or-no question; `null` on Ctrl-C, after the terminal was restored
 * and the interrupt sent, for a caller that must not carry on as if it were
 * no.
 */
export const confirmOrStop = async (
  io: PromptIO,
  options: ConfirmOptions,
): Promise<boolean | null> => {
  const { question, signal } = options;
  const fallback = options.default === true;
  if (signal?.aborted === true) throw withdrawn(signal);
  if (!canKey(io.input, io.output, io.env)) {
    const suffix = fallback ? "[Y/n]" : "[y/N]";
    const answer = (
      (await readLine(io, `  ${question} ${suffix} `, signal)) ?? ""
    )
      .trim()
      .toLowerCase();
    return answer === "" ? fallback : ["y", "yes"].includes(answer);
  }
  const term = () => termOf(io.output, io.env);
  const region = createRegion(io.output, term);
  return new Promise<boolean | null>((resolve, reject) => {
    let yes = fallback;
    const render = (): void => {
      const t = term();
      const asked = hang(" ? ", question, t.width).map((line, i) =>
        i === 0
          ? ` ${paint(t, "accent", "?")} ${bold(t, line.slice(3))}`
          : line,
      );
      const pick = (label: string, on: boolean): string =>
        on ? apply(t, "inverse", ` ${label} `) : ` ${label} `;
      const keys = paint(t, "muted", "y/n · ←/→ · Enter");
      region.draw([
        ...asked,
        `   ${pick("Yes", yes)} ${pick("No", !yes)}  ${keys}`,
      ]);
    };
    const finish = (answer: boolean): void => {
      stop();
      io.output.off("resize", render);
      signal?.removeEventListener("abort", onAbort);
      const t = term();
      const mark = answer ? paint(t, "ok", "✓") : paint(t, "danger", "✗");
      region.finish(
        cut(` ${mark} ${question} · ${answer ? "Yes" : "No"}`, t.width),
      );
      resolve(answer);
    };
    const onAbort = (): void => {
      stop();
      io.output.off("resize", render);
      region.finish();
      reject(withdrawn(signal));
    };
    const stop = readKeys(io.input, key => {
      if (key.name === "enter") finish(yes);
      else if (key.name === "escape") finish(false);
      else if (key.name === "ctrl-c") {
        stop();
        io.output.off("resize", render);
        signal?.removeEventListener("abort", onAbort);
        region.finish();
        resolve(null);
        interrupt(io);
      } else if (key.name === "left" || key.name === "right") {
        yes = !yes;
        render();
      } else if (key.name === "char") {
        const c = key.text.toLowerCase();
        if (c === "y") finish(true);
        else if (c === "n") finish(false);
        else if (c === "h" || c === "l" || c === " ") {
          yes = !yes;
          render();
        }
      }
    });
    io.output.on("resize", render);
    signal?.addEventListener("abort", onAbort, { once: true });
    render();
  });
};

/** Asks a yes-or-no question; Ctrl-C (after restoring the terminal) is no. */
export const confirm = async (
  io: PromptIO,
  options: ConfirmOptions,
): Promise<boolean> => (await confirmOrStop(io, options)) === true;
