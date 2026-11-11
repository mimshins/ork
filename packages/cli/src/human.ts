/**
 * @file The terminal `HumanChannel`: answers `ask_user` questions, gates and
 *   permission prompts on the terminal, one at a time, and denies or defers
 *   when no one is there. It draws through the terminal kit (`term/`): a card
 *   with an ASK chip and a list moved with the arrow keys, a yes-or-no for a
 *   permission, and one optional line for a note after a choice. Plain (not a
 *   terminal, `NO_COLOR`, `--plain`) it keeps the numbered prompts. In a run it
 *   is the decision queue's local answerer, racing `ork decide`.
 */

import { createInterface, type Interface } from "node:readline/promises";

import {
  type HumanChannel,
  type HumanQuestion,
  TOOL_INPUT_KEYS,
} from "@krapht/ork-core";

import {
  type AskPlace,
  cardLines,
  clean,
  doneLine,
  permitLine,
} from "./human-card.ts";
import { plain } from "./output.ts";
import { confirmOrStop } from "./term/confirm.ts";
import { withdrawn } from "./term/line.ts";
import { plainEnv, type PromptIO, type Term, termOf } from "./term/mode.ts";
import { plainOptions, select, type SelectOption } from "./term/select.ts";
import { readText } from "./term/text.ts";
import { paint } from "./term/theme.ts";

export type TerminalIO = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** False when stdin is not a terminal: no one can answer. */
  interactive: boolean;
  /** Ctrl-C at a prompt, which the terminal takes from the process in raw mode. */
  interrupt?: () => void;
  /** Shows a question's whole context, not its first lines (`--verbose`). */
  verbose?: boolean;
  /** The environment that decides rich or plain; `process.env` when not given. */
  env?: NodeJS.ProcessEnv;
};

export type { AskPlace };

export type TerminalHuman = HumanChannel & {
  close: () => void;
  /**
   * `ask` for `ork decide`: the card names the run and "n of m", the answer
   * collapses to the decision's id, and `q` or Esc leaves the question for
   * later (resolves `null`).
   */
  askAt: (question: HumanQuestion, place: AskPlace) => Promise<string | null>;
};

const PREVIEW = 160;

/** A document longer than this is offered (`d`) rather than printed. */
const SHORT_DOCUMENT_LINES = 40;

const NO_ONE_TO_PERMIT =
  "No one is at the terminal to approve this tool, so it is not allowed in this run.";

const NOTE_MESSAGE = "Note for the run (optional, Enter to skip)";

const NO_ONE_TO_ASK =
  "no one (nobody is at the terminal; use your best judgment and say so in your report)";

/**
 * What a foreground caller shows of the runs it calls: their lines always, and
 * their questions only when stdin is a terminal, so no one is answered for.
 */
export const callsShown = (
  human: TerminalHuman,
  stdinIsTty?: boolean,
): { ask?: TerminalHuman } => (stdinIsTty === true ? { ask: human } : {});

/** One line that shows what a tool is about to do. */
export const previewInput = (
  toolName: string,
  input: Record<string, unknown>,
): string => {
  const key = TOOL_INPUT_KEYS.find(k => typeof input[k] === "string");
  const value =
    key === undefined ? JSON.stringify(input) : `${key}: ${String(input[key])}`;
  const line = value.replaceAll(/\s+/gu, " ").trim();
  return line.length > PREVIEW
    ? `${toolName} ${line.slice(0, PREVIEW - 1)}…`
    : `${toolName} ${line}`;
};

/** Never answers, until `signal` withdraws it: what a stopped prompt leaves. */
const parked = (signal: AbortSignal | undefined): Promise<never> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(withdrawn(signal));
    });
  });

/**
 * Answers permission prompts and `ask_user` questions on the terminal, one at a
 * time. Without a terminal it denies tools and leaves questions to the node,
 * but a gate's question (`waits`) waits for `ork decide` or the UI. A withdrawn
 * prompt (answered elsewhere) rejects, which frees the turn.
 */
export const createTerminalHuman = (io: TerminalIO): TerminalHuman => {
  let rl: Interface | undefined;
  let closed: Promise<undefined> | undefined;
  let turn: Promise<unknown> = Promise.resolve();

  const say = (text: string): void => {
    io.output.write(`${text}\n`);
  };
  /** The one `readline` the plain prompts share; a rich prompt never opens it. */
  const readLine = (
    text: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> => {
    if (rl === undefined) {
      const opened = createInterface({
        input: io.input,
        output: io.output,
        ...(plainEnv(io.env) ? { terminal: false } : {}),
      });
      if (io.interrupt !== undefined) opened.on("SIGINT", io.interrupt);
      closed = new Promise<undefined>(resolve => {
        opened.once("close", () => {
          // oxlint-disable-next-line unicorn/no-useless-undefined -- a closed input answers nothing
          resolve(undefined);
        });
      });
      rl = opened;
    }
    const answer =
      signal === undefined ? rl.question(text) : rl.question(text, { signal });
    return closed === undefined ? answer : Promise.race([answer, closed]);
  };
  const kit: PromptIO = {
    input: io.input,
    output: io.output,
    readLine,
    ...(io.env === undefined ? {} : { env: io.env }),
    ...(io.interrupt === undefined ? {} : { interrupt: io.interrupt }),
  };
  const term = (): Term => termOf(io.output, io.env);

  /** The optional line after a choice, when the asker takes a note. */
  const takeNote = async (
    onNote: ((note: string) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    if (onNote === undefined) return;
    const noted = await readText(kit, {
      message: NOTE_MESSAGE,
      ...(signal === undefined ? {} : { signal }),
    });
    if (noted.kind === "interrupted") await parked(signal);
    if (noted.kind === "text" && noted.value !== "") onNote(noted.value);
  };
  /** Says where a waiting question is answered, and waits until withdrawn. */
  const waitElsewhere = (q: HumanQuestion): Promise<never> => {
    say(
      paint(
        term(),
        "muted",
        `  no terminal; ${plain(q.nodeId)} waits for ork decide or ork ui`,
      ),
    );
    return parked(q.signal);
  };

  // Prompts from parallel tool calls wait for each other.
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const result = turn.then(work);
    turn = result.catch(() => null);
    return result;
  };

  const asking = (q: HumanQuestion, place?: AskPlace): Promise<string | null> =>
    // A gate waits for `ork decide` or the UI when no one is here, outside the
    // one-at-a-time queue, so the prompts after it don't wait behind it.
    !io.interactive && q.waits === true
      ? waitElsewhere(q)
      : oneAtATime(async () => {
          const { signal } = q;
          if (signal?.aborted === true)
            throw new Error("the question was withdrawn");
          const t = term();
          const documentLines = q.document?.trimEnd().split("\n").length ?? 0;
          const document =
            q.document === undefined ? undefined : clean(q.document);
          const printed =
            document !== undefined && documentLines <= SHORT_DOCUMENT_LINES;
          const shownDocument = t.rich || !printed ? undefined : document;
          const header = (tt: Term): string[] =>
            cardLines(tt, q, place, io.verbose === true, shownDocument).lines;
          const options: SelectOption[] = q.options.map(o => ({
            id: o.id,
            ...(o.label === undefined ? {} : { label: plain(o.label) }),
            ...(o.description === undefined
              ? {}
              : { description: plain(o.description) }),
          }));
          // Plain prints a short document first and offers a long one; a card
          // offers any document, and the context its lines cut.
          const { moreContext } = cardLines(t, q, place, io.verbose === true);
          const details = t.rich
            ? [moreContext ? clean(q.context ?? "") : undefined, document]
                .filter(part => part !== undefined)
                .join("\n\n") || undefined
            : printed
              ? undefined
              : document;
          if (!io.interactive) {
            for (const line of header(t)) say(line);
            for (const line of plainOptions(options, q.recommended)) say(line);
            const answer = q.recommended ?? NO_ONE_TO_ASK;
            say(paint(t, "muted", `  no terminal; answered ${answer}`));
            return answer;
          }
          const result = await select(kit, {
            header,
            options,
            ...(q.recommended === undefined
              ? {}
              : { recommended: q.recommended }),
            ...(details === undefined ? {} : { details }),
            ...(!t.rich && details !== undefined
              ? {
                  footer: [
                    `  Document: ${String(documentLines)} lines. Type d to read it.`,
                  ],
                }
              : {}),
            note: q.onNote !== undefined,
            notePrompt: NOTE_MESSAGE,
            later: place !== undefined,
            done: (answer, tt) => doneLine(tt, place, q.nodeId, answer),
            ...(signal === undefined ? {} : { signal }),
          });
          if (result.kind === "interrupted") return parked(signal);
          if (result.kind === "later") return null;
          if (result.note !== undefined) q.onNote?.(result.note);
          return result.id;
        });

  return {
    permit: ({ nodeId, toolName, input, signal, onNote }) =>
      oneAtATime(async () => {
        if (signal?.aborted === true) {
          throw new Error("the prompt was withdrawn");
        }
        const t = term();
        if (t.rich) say("");
        say(permitLine(t, nodeId, previewInput(toolName, input)));
        if (!io.interactive) {
          say(paint(t, "muted", `  denied: ${NO_ONE_TO_PERMIT}`));
          return { allow: false, message: NO_ONE_TO_PERMIT };
        }
        const allowed = await confirmOrStop(kit, {
          question: "Allow?",
          ...(signal === undefined ? {} : { signal }),
        });
        // Ctrl-C stops the run: no note is asked for, and no answer comes.
        if (allowed === null) return parked(signal);
        if (allowed) return { allow: true };
        // A denial may say why; an allowal has nothing to tell the session.
        await takeNote(onNote, signal);
        return { allow: false, message: "The user did not allow this tool." };
      }),

    // A withdrawn question (a gate's timeout) rejects, which frees the turn.
    ask: async q => (await asking(q)) ?? NO_ONE_TO_ASK,

    askAt: (q, place) => asking(q, place),

    close: () => {
      rl?.close();
    },
  };
};
