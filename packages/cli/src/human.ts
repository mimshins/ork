/**
 * @file The terminal `HumanChannel`: answers `ask_user` questions, gates and
 *   permission prompts on the terminal, one at a time, and denies or defers
 *   when no one is there. After a choice it offers one optional line for a
 *   note, which Enter skips. In a run it is the decision queue's local
 *   answerer, racing `ork decide`.
 */

import { createInterface, type Interface } from "node:readline/promises";

import {
  type DecisionChoice,
  type HumanChannel,
  type NoteTaker,
  TOOL_INPUT_KEYS,
} from "@krapht/ork-core";

import { style } from "./output.ts";

export type TerminalIO = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** False when stdin is not a terminal: no one can answer. */
  interactive: boolean;
  /** Ctrl-C at a prompt, which readline takes from the process in raw mode. */
  interrupt?: () => void;
};

export type TerminalHuman = HumanChannel & { close: () => void };

const PREVIEW = 160;

/** A document longer than this is offered (`d`) rather than printed. */
const SHORT_DOCUMENT_LINES = 40;

const NO_ONE_TO_PERMIT =
  "No one is at the terminal to approve this tool, so it is not allowed in this run.";

const NOTE_PROMPT = "  Note for the run (optional, Enter to skip): ";

const NO_ONE_TO_ASK =
  "no one (nobody is at the terminal; use your best judgment and say so in your report)";

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

/** The option an answer names: its number, or its id. */
export const pickOption = (
  answer: string,
  options: readonly DecisionChoice[],
  recommended: string | undefined,
): string | undefined => {
  const value = answer.trim();
  if (value === "") return recommended;
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    return options[index - 1]?.id;
  }
  return options.find(o => o.id === value)?.id;
};

const optionLine = (
  option: DecisionChoice,
  index: number,
  recommended: string | undefined,
): string => {
  const label = option.label === undefined ? "" : ` ${option.label}`;
  const description =
    option.description === undefined
      ? ""
      : style("dim", ` - ${option.description}`);
  const mark =
    option.id === recommended ? style("green", " (recommended)") : "";
  return `  ${String(index + 1)}) ${style("bold", option.id)}${label}${description}${mark}`;
};

/**
 * Answers permission prompts and `ask_user` questions on the terminal, one at a
 * time. Without a terminal it denies tools and leaves questions to the node. A
 * withdrawn prompt (answered elsewhere) rejects, which frees the turn.
 */
export const createTerminalHuman = (io: TerminalIO): TerminalHuman => {
  let rl: Interface | undefined;
  let turn: Promise<unknown> = Promise.resolve();

  const say = (text: string): void => {
    io.output.write(`${text}\n`);
  };
  const prompt = (text: string, signal?: AbortSignal): Promise<string> => {
    if (rl === undefined) {
      rl = createInterface({ input: io.input, output: io.output });
      if (io.interrupt !== undefined) rl.on("SIGINT", io.interrupt);
    }
    return signal === undefined
      ? rl.question(text)
      : rl.question(text, { signal });
  };
  /** The optional line after a choice, when the asker takes a note. */
  const takeNote = async (
    onNote: NoteTaker | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    if (onNote === undefined) return;
    const note = (await prompt(NOTE_PROMPT, signal)).trim();
    if (note !== "") onNote(note);
  };
  const choose = async (
    hint: string,
    options: readonly DecisionChoice[],
    recommended: string | undefined,
    signal: AbortSignal | undefined,
    document: string | undefined,
  ): Promise<string> => {
    const answer = await prompt(`  Choose${hint}: `, signal);
    // Picked first, so an option named `d` wins over reading the document.
    const picked = pickOption(answer, options, recommended);
    if (picked !== undefined) return picked;
    if (document !== undefined && answer.trim() === "d") say(document);
    else say(style("dim", "  Type an option's number or id."));
    return choose(hint, options, recommended, signal, document);
  };
  // Prompts from parallel tool calls wait for each other.
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const result = turn.then(work);
    turn = result.catch(() => null);
    return result;
  };

  return {
    permit: ({ nodeId, toolName, input, signal, onNote }) =>
      oneAtATime(async () => {
        if (signal?.aborted === true) {
          throw new Error("the prompt was withdrawn");
        }
        say(
          `${style(["yellow", "bold"], "?")} ${style("bold", nodeId)} wants to run ${previewInput(toolName, input)}`,
        );
        if (!io.interactive) {
          say(style("dim", `  denied: ${NO_ONE_TO_PERMIT}`));
          return { allow: false, message: NO_ONE_TO_PERMIT };
        }
        const answer = (await prompt("  Allow? [y/N] ", signal))
          .trim()
          .toLowerCase();
        if (answer === "y" || answer === "yes") return { allow: true };
        // A denial may say why; an allowal has nothing to tell the session.
        await takeNote(onNote, signal);
        return { allow: false, message: "The user did not allow this tool." };
      }),

    // A withdrawn question (a gate's timeout) rejects, which frees the turn.
    ask: ({
      nodeId,
      question,
      options,
      recommended,
      context,
      document,
      signal,
      onNote,
    }) =>
      oneAtATime(async () => {
        if (signal?.aborted === true) {
          throw new Error("the question was withdrawn");
        }
        const documentLines = document?.trimEnd().split("\n").length ?? 0;
        if (document !== undefined && documentLines <= SHORT_DOCUMENT_LINES) {
          say(document);
        }
        say(
          `${style(["yellow", "bold"], "?")} ${style("bold", nodeId)} asks: ${question}`,
        );
        if (context !== undefined) {
          say(style("dim", `  ${context.replaceAll("\n", "\n  ")}`));
        }
        for (const [index, option] of options.entries()) {
          say(optionLine(option, index, recommended));
        }
        if (!io.interactive) {
          const answer = recommended ?? NO_ONE_TO_ASK;
          say(style("dim", `  no terminal; answered ${answer}`));
          return answer;
        }
        const fallback = options.findIndex(o => o.id === recommended);
        const hint = fallback === -1 ? "" : ` [${String(fallback + 1)}]`;
        if (documentLines > SHORT_DOCUMENT_LINES) {
          say(`  Document: ${String(documentLines)} lines. Type d to read it.`);
        }
        const picked = await choose(
          hint,
          options,
          recommended,
          signal,
          document,
        );
        await takeNote(onNote, signal);
        return picked;
      }),

    close: () => {
      rl?.close();
    },
  };
};
