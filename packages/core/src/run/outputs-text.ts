/**
 * @file A finished run's declared `outputs:` as text for a person: one entry
 *   per key, scrubbed of escape sequences (a value comes from sessions) and cut
 *   when long. The CLI and the server share it, each adding its own pointer to
 *   the full value, which stays in the run's `run.finished` event.
 */

import { stripVTControlCharacters } from "node:util";

/** The most lines, and characters, of one value shown. */
export const OUTPUT_MAX_LINES = 20;
export const OUTPUT_MAX_CHARS = 2000;

/** One declared output: its key, its text (cut when long), and whether it was. */
export type OutputText = { name: string; text: string; cut: boolean };

/** Escapes stripped, other control characters (not line breaks, tabs) blanked. */
const scrub = (value: string): string =>
  stripVTControlCharacters(value).replaceAll(
    /[^\P{Cc}\n\t]|\p{Bidi_Control}/gu,
    " ",
  );

/**
 * The declared outputs in key order, each scrubbed and cut to
 * {@link OUTPUT_MAX_LINES} lines and {@link OUTPUT_MAX_CHARS} characters; empty
 * when there are none.
 */
export const outputsText = (
  outputs?: Readonly<Record<string, string>>,
): OutputText[] =>
  Object.entries(outputs ?? {}).map(([name, value]) => {
    const clean = scrub(value.replaceAll("\r\n", "\n")).trimEnd();
    const lines = clean.split("\n");
    const byLines = lines.slice(0, OUTPUT_MAX_LINES).join("\n");
    const text = byLines.slice(0, OUTPUT_MAX_CHARS);
    return { name, text, cut: text.length < clean.length };
  });
