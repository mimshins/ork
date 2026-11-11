/**
 * @file The terminal kit's mode: rich (color, chips, redrawn prompts) or plain
 *   (no escape codes, no redraw, line prompts). It is rich only when the stream
 *   is a terminal and nothing asks for plain: `NO_COLOR`, `ORK_PLAIN=1` (what
 *   the global `--plain` flag sets), or `TERM=dumb`. Every other module of the
 *   kit takes a {@link Term} from here, so a test passes a fake stream.
 */

/** A stream the kit writes to; a terminal sets `isTTY`, `columns` and `rows`. */
export type TermStream = NodeJS.WritableStream & {
  isTTY?: boolean;
  columns?: number;
  rows?: number;
};

/** A stream the kit reads keys from; raw mode is what a rich prompt needs. */
export type KeyStream = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

/** How to write to a stream: whether to style, and how wide it is. */
export type Term = {
  /** Color, chips and redraw; false means plain text and line prompts. */
  rich: boolean;
  /** Columns, never under {@link MIN_WIDTH}; 80 when the stream gives none. */
  width: number;
  /** Rows, or 24 when the stream gives none. */
  rows: number;
};

/** The narrowest width the kit lays out for. */
export const MIN_WIDTH = 20;

const DEFAULT_WIDTH = 80;
const DEFAULT_ROWS = 24;

/** Whether `ORK_PLAIN` is on: set, and not `0` or `false`. */
const orkPlain = (value: string | undefined): boolean =>
  value !== undefined && !["", "0", "false"].includes(value.toLowerCase());

/** Whether the environment asks for plain output (not the stream). */
export const plainEnv = (env: NodeJS.ProcessEnv = process.env): boolean =>
  (env["NO_COLOR"] ?? "") !== "" ||
  orkPlain(env["ORK_PLAIN"]) ||
  env["TERM"] === "dumb";

/** How to write to `stream`, given `env`. */
export const termOf = (
  stream: TermStream,
  env: NodeJS.ProcessEnv = process.env,
): Term => ({
  rich: stream.isTTY === true && !plainEnv(env),
  width: Math.max(MIN_WIDTH, stream.columns ?? DEFAULT_WIDTH),
  rows: stream.rows ?? DEFAULT_ROWS,
});

/** Whether a prompt can take keys and redraw: rich output, a raw-mode input. */
export const canKey = (
  input: KeyStream,
  output: TermStream,
  env: NodeJS.ProcessEnv = process.env,
): boolean =>
  termOf(output, env).rich &&
  input.isTTY === true &&
  typeof input.setRawMode === "function";

/**
 * Takes the global `--plain` flag out of `argv` (up to a `--`, after which
 * words belong to a program). It sets `ORK_PLAIN=1` in `env`, which every child
 * Ork starts then inherits.
 */
export const takePlainFlag = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] => {
  const end = argv.indexOf("--");
  const head = end === -1 ? argv : argv.slice(0, end);
  if (!head.includes("--plain")) return [...argv];
  env["ORK_PLAIN"] = "1";
  return [
    ...head.filter(word => word !== "--plain"),
    ...argv.slice(head.length),
  ];
};

/** What a prompt needs: where keys come from and where it draws. */
export type PromptIO = {
  input: KeyStream;
  output: TermStream;
  /** The environment for the mode; `process.env` when not given. */
  env?: NodeJS.ProcessEnv;
  /**
   * How a plain prompt reads a line, when the caller already holds a `readline`
   * on the input; resolves `undefined` when the input ends. Without it, each
   * plain prompt opens and closes its own.
   */
  readLine?: (
    prompt: string,
    signal?: AbortSignal,
  ) => Promise<string | undefined>;
  /**
   * Called after a prompt restored the terminal on Ctrl-C; the default is to
   * send this process `SIGINT`.
   */
  interrupt?: () => void;
};
