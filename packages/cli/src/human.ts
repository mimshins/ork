import { createInterface, type Interface } from "node:readline/promises";

import type { DecisionChoice, HumanChannel } from "@krapht/ork-core";

import { style } from "./output.ts";

export type TerminalIO = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** False when stdin is not a terminal: no one can answer. */
  interactive: boolean;
};

export type TerminalHuman = HumanChannel & { close: () => void };

const PREVIEW = 160;

const NO_ONE_TO_PERMIT =
  "No one is at the terminal to approve this tool, so it is not allowed in this run.";

const NO_ONE_TO_ASK =
  "no one (nobody is at the terminal; use your best judgment and say so in your report)";

/** One line that shows what a tool is about to do. */
export const previewInput = (
  toolName: string,
  input: Record<string, unknown>,
): string => {
  const key = ["command", "file_path", "path", "url", "pattern"].find(
    k => typeof input[k] === "string",
  );
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
 * time. Without a terminal it denies tools and leaves questions to the node.
 * The decision queue (M1d) replaces it.
 */
export const createTerminalHuman = (io: TerminalIO): TerminalHuman => {
  let rl: Interface | undefined;
  let turn: Promise<unknown> = Promise.resolve();

  const say = (text: string): void => {
    io.output.write(`${text}\n`);
  };
  const prompt = (text: string, signal?: AbortSignal): Promise<string> => {
    rl ??= createInterface({ input: io.input, output: io.output });
    return signal === undefined
      ? rl.question(text)
      : rl.question(text, { signal });
  };
  const choose = async (
    hint: string,
    options: readonly DecisionChoice[],
    recommended: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<string> => {
    const picked = pickOption(
      await prompt(`  Choose${hint}: `, signal),
      options,
      recommended,
    );
    if (picked !== undefined) return picked;
    say(style("dim", "  Type an option's number or id."));
    return choose(hint, options, recommended, signal);
  };
  // Prompts from parallel tool calls wait for each other.
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const result = turn.then(work);
    turn = result.catch(() => null);
    return result;
  };

  return {
    permit: ({ nodeId, toolName, input }) =>
      oneAtATime(async () => {
        say(
          `${style(["yellow", "bold"], "?")} ${style("bold", nodeId)} wants to run ${previewInput(toolName, input)}`,
        );
        if (!io.interactive) {
          say(style("dim", `  denied: ${NO_ONE_TO_PERMIT}`));
          return { allow: false, message: NO_ONE_TO_PERMIT };
        }
        const answer = (await prompt("  Allow? [y/N] ")).trim().toLowerCase();
        return answer === "y" || answer === "yes"
          ? { allow: true }
          : { allow: false, message: "The user did not allow this tool." };
      }),

    // A withdrawn question (a gate's timeout) rejects, which frees the turn.
    ask: ({ nodeId, question, options, recommended, context, signal }) =>
      oneAtATime(() => {
        if (signal?.aborted === true) {
          return Promise.reject(new Error("the question was withdrawn"));
        }
        say(
          `${style(["yellow", "bold"], "?")} ${style("bold", nodeId)} asks: ${question}`,
        );
        if (context !== undefined) say(style("dim", `  ${context}`));
        for (const [index, option] of options.entries()) {
          say(optionLine(option, index, recommended));
        }
        if (!io.interactive) {
          const answer = recommended ?? NO_ONE_TO_ASK;
          say(style("dim", `  no terminal; answered ${answer}`));
          return Promise.resolve(answer);
        }
        const fallback = options.findIndex(o => o.id === recommended);
        const hint = fallback === -1 ? "" : ` [${String(fallback + 1)}]`;
        return choose(hint, options, recommended, signal);
      }),

    close: () => {
      rl?.close();
    },
  };
};
