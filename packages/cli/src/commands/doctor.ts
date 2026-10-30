/**
 * @file `ork doctor`: prints the environment checks (Node, git, and the user's
 *   own claude, gh and aws logins) and fails when no Claude driver can run. Ork
 *   stores no credentials.
 */

import type { CheckResult } from "@krapht/ork-integrations";
import { defineCommand } from "citty";

import { exec, runChecks } from "../doctor/checks.ts";
import { style, write } from "../output.ts";

const MARK: Record<CheckResult["status"], string> = {
  ok: style("green", "✓"),
  warn: style("yellow", "!"),
  fail: style("red", "✗"),
  skip: style("dim", "-"),
};

export const formatCheck = (result: CheckResult): string[] => {
  const line = `${MARK[result.status]} ${result.name.padEnd(20)} ${result.detail}`;
  return result.hint === undefined
    ? [line]
    : [line, `  ${style("dim", result.hint)}`];
};

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description:
      "Check Node, git, and your own claude, gh, and aws logins (Ork stores no credentials)",
  },
  run: async () => {
    const { results, ok } = await runChecks(
      exec,
      process.env,
      process.versions.node,
    );
    for (const result of results) {
      for (const line of formatCheck(result)) write(line);
    }
    if (!ok) {
      write(
        `\n${style("red", "Not ready:")} Ork needs Node, git, and at least one Claude driver.`,
      );
      process.exitCode = 1;
    }
  },
});
