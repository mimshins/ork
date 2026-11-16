/**
 * @file The hidden `ork __onboard <verb>`: what the tool nodes of the built-in
 *   `ork:onboard-propose` and `ork:onboard-write` workflows run (`format`,
 *   `canon`, `filter`, `finish`). Left out of `ork --help` and tab completion
 *   like `ork __complete`, documented only in specs/cli/onboard-verbs.md, and
 *   free to change without notice. A usage error is one stderr line and exit 2.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { defineCommand } from "citty";

import { canonFiles } from "../onboard/verbs-canon.ts";
import { filterText } from "../onboard/verbs-filter.ts";
import { finish, finishText } from "../onboard/verbs-finish.ts";
import { formatBrief } from "../onboard/verbs-format.ts";
import { write, writeErr } from "../output.ts";

const VERBS = ["format", "canon", "filter", "finish"];

const usage = (message: string): void => {
  writeErr(`ork __onboard: ${message}`);
  process.exitCode = 2;
};

const options = {
  file: { type: "string" },
  worktree: { type: "string" },
  branch: { type: "string" },
} as const;

/** The verb and its words, or null after a usage error. */
const parsed = (
  args: readonly string[],
): {
  verb: string;
  words: string[];
  values: { file?: string; worktree?: string; branch?: string };
} | null => {
  const [verb = "", ...rest] = args;
  if (!VERBS.includes(verb)) {
    usage(`unknown verb \`${verb}\` (${VERBS.join(", ")})`);
    return null;
  }
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options,
      allowPositionals: true,
      strict: true,
    });
    return { verb, words: positionals, values };
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
    return null;
  }
};

const runCanon = (files: readonly string[]): void => {
  if (files.length === 0) {
    usage("canon needs at least one file");
    return;
  }
  for (const result of canonFiles(process.cwd(), files)) {
    if (result.status === "failed") {
      writeErr(`${result.file}: ${result.reason}`);
      process.exitCode = 1;
    } else write(`${result.status} ${result.file}`);
  }
};

const runFilter = (file: string | undefined): void => {
  let text: string;
  try {
    text = readFileSync(file ?? 0, "utf8");
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
    return;
  }
  write(JSON.stringify(filterText(text, process.cwd())));
};

const runFinish = async (
  worktree: string | undefined,
  branch: string | undefined,
): Promise<void> => {
  if (worktree === undefined || branch === undefined) {
    usage("finish needs --worktree and --branch");
    return;
  }
  const report = await finish({
    root: process.cwd(),
    worktree,
    branch,
    run: process.env["ORK_RUN"],
  });
  process.stdout.write(finishText(report));
  if (report.problems.length > 0) process.exitCode = 1;
};

export const onboardVerbs = defineCommand({
  meta: {
    name: "__onboard",
    description: "What the onboarding workflows' tool nodes run",
    hidden: true,
  },
  run: async ({ rawArgs }) => {
    const call = parsed(rawArgs);
    if (call === null) return;
    const { verb, words, values } = call;
    if (verb === "format") {
      const brief = formatBrief(words);
      if (brief.ok) process.stdout.write(brief.text);
      else usage(brief.error);
    } else if (verb === "canon") runCanon(words);
    else if (verb === "filter") runFilter(values.file);
    else await runFinish(values.worktree, values.branch);
  },
});
