/**
 * @file The two built-in runs of `ork onboard`, and what is said when the
 *   second ends: `ork:onboard-propose` and `ork:onboard-write` run through the
 *   same code as `ork run`, on the driver picked, with everything they take as
 *   untrusted inputs (specs/cli/onboard-flow.md). The write run's branch is
 *   settled as `ork feedback apply`'s is, with `runs/apply.ts`'s code.
 */

import {
  builtinProblem,
  builtinWorkflowFile,
  type EventStore,
  type ProjectPlace,
  type ResumeState,
  type RunResult,
} from "@krapht/ork-core";
import type { Driver } from "@krapht/ork-schema";

import { cost, plain, shortCount } from "../output.ts";
import { runWorkflowFile, type RunWorkflowOptions } from "../run/workflow.ts";
import {
  type ApplyOutcome,
  type commitsAhead,
  discardRun,
  keptBranch,
  outcomeOf,
} from "../runs/apply.ts";
import { PROPOSE, WRITE } from "./caps.ts";
import type { Suggestion } from "./suggestion.ts";

export type RunOptions = Pick<
  RunWorkflowOptions,
  | "runtime"
  | "driverChecks"
  | "drivers"
  | "tools"
  | "installed"
  | "human"
  | "out"
  | "err"
  | "home"
  | "onRun"
> & {
  store: EventStore;
  place: ProjectPlace;
  driver: Driver;
  /** Counts the run's commits; tests pass their own. */
  ahead?: typeof commitsAhead;
};

export type Ran =
  | { ok: true; result: RunResult }
  | { ok: false; lines: string[] };

/** The run id and what to do about a run that did not succeed. */
export const failedLines = (what: string, result: RunResult): string[] => [
  `${what} didn't finish (${result.status}), run ${result.runId}: \`ork resume ${result.runId}\` continues that run.`,
  ...result.reasons.map(plain),
];

/**
 * What a run spent: dollars where the driver reports them, tokens always (when
 * counted). A run on a driver with no dollars shows its tokens alone.
 */
export const spentLine = (spent: {
  costUsd: number;
  tokens?: number | undefined;
  partial?: true | undefined;
}): string =>
  [
    spent.partial === true && spent.costUsd === 0
      ? ""
      : `${cost(spent.costUsd)}${spent.partial === true ? " (partial)" : ""}`,
    spent.tokens === undefined ? "" : `${shortCount(spent.tokens)} tokens`,
  ]
    .filter(part => part !== "")
    .join(" · ") || "nothing";

/** What Ctrl-C at the pick says: which run holds the proposal, and the way back. */
export const interruptedLines = (run: {
  id: string;
  spent: string;
}): string[] => [
  `Stopped at the pick. The proposing run ${run.id} spent ${run.spent}.`,
  "Run `ork onboard` again to pick from it.",
];

/** A stored run to continue, as `ork resume` passes it. */
export type Resumed = { runId: string; resume: ResumeState };

const runBuiltin = async (
  options: RunOptions,
  name: string,
  inputs: readonly string[],
  untrusted: string[],
  resumed?: Resumed,
): Promise<Ran> => {
  const { place } = options;
  const problem = builtinProblem(place, name);
  const file = builtinWorkflowFile(place, name);
  if (problem !== undefined || file === undefined) {
    return { ok: false, lines: [problem ?? `${name} couldn't be written.`] };
  }
  const { result } = await runWorkflowFile({
    ...options,
    file,
    cwd: place.root,
    inputs,
    untrusted,
    inPlace: false,
    json: false,
    driver: options.driver,
    ...resumed,
  });
  return result === null
    ? { ok: false, lines: [`${name} didn't start.`] }
    : { ok: true, result };
};

/**
 * Runs `ork:onboard-propose`; `history` is empty on a first visit. Given a
 * stored run, it continues that run with the inputs it recorded instead.
 */
export const runPropose = (
  options: RunOptions,
  input: { survey: string; answers: string; history: string } | Resumed,
): Promise<Ran> =>
  runBuiltin(
    options,
    PROPOSE,
    "resume" in input
      ? []
      : [
          `survey=${input.survey}`,
          `answers=${input.answers}`,
          ...(input.history === "" ? [] : [`history=${input.history}`]),
        ],
    ["survey", "answers", "history"],
    "resume" in input ? input : undefined,
  );

/** Runs `ork:onboard-write` for the picks; `note` joins the survey when set. */
export const runWrite = (
  options: RunOptions,
  input: {
    picks: readonly Suggestion[];
    survey: string;
    answers: string;
    note: string;
  },
): Promise<Ran> =>
  runBuiltin(
    options,
    WRITE,
    [
      `picks=${JSON.stringify(input.picks)}`,
      `survey=${input.note === "" ? input.survey : `${input.survey}\n\n${input.note}`}`,
      `answers=${input.answers}`,
    ],
    ["picks", "survey", "answers"],
  );

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * What `finish` last printed when it exited 1: the writer's problems. Any other
 * exit (127, a timeout) means it could not check, so there are none to show.
 */
export const finishProblems = (result: RunResult): string[] => {
  const finish = result.nodes.find(n => n.id === "finish");
  if (finish?.ok !== false || finish.output?.["exitCode"] !== 1) return [];
  const out = text(finish.output?.["stdout"]) || (finish.error ?? "");
  return out
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line !== "");
};

export type Settled = { lines: string[]; code: number };

/** What to say, and the exit code, once the write run ended. */
export const settleWrite = async (
  options: RunOptions,
  result: RunResult,
  cited: readonly string[],
  gitignored: boolean,
): Promise<Settled> => {
  const { store, place } = options;
  const outcome: ApplyOutcome = outcomeOf(result, "write");
  switch (outcome.kind) {
    case "kept": {
      const branch = await keptBranch(
        store,
        place.root,
        result.runId,
        options.ahead,
      );
      if (!branch.kept) {
        return {
          lines: [
            "the branch holds no commits, so there's nothing to keep",
            ...branch.removed,
          ],
          code: 0,
        };
      }
      return {
        lines: [
          `kept the workflows on ${outcome.branch}`,
          "Review and merge it like any other change; Ork never merges it.",
          ...(cited.length === 0
            ? []
            : [
                `Feedback items your suggestions cited (still open, not resolved): ${cited.join(", ")}`,
              ]),
          ...(gitignored
            ? ["Commit the .gitignore change `ork onboard` made with it."]
            : []),
        ],
        code: 0,
      };
    }
    case "discarded":
      return {
        lines: [
          "discarded the change; nothing was kept",
          ...(await discardRun(store, place.root, result.runId)),
        ],
        code: 0,
      };
    case "nothing":
    case "unfinished": {
      const problems = finishProblems(result);
      return {
        lines: [
          ...failedLines("the writing run", result),
          ...(problems.length === 0
            ? outcome.kind === "nothing" && outcome.summary !== ""
              ? [plain(outcome.summary)]
              : []
            : [
                "What the check last found, after 3 rounds:",
                ...problems.map(line => `  ${plain(line)}`),
              ]),
        ],
        code: 1,
      };
    }
    default:
      return outcome satisfies never;
  }
};
