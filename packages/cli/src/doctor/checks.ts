/**
 * @file The checks behind `ork doctor`: each tool's presence and login status,
 *   through an injectable `exec` so tests need no real tools. Never prints a
 *   token or an account.
 */

import { execFile } from "node:child_process";

import {
  CLAUDE_DRIVERS,
  type CheckResult,
  type Env,
  type Exec,
  firstLine,
  INTEGRATIONS,
} from "@krapht/ork-integrations";

const TIMEOUT_MS = 15_000;

export const exec: Exec = (program, args) =>
  new Promise(resolve => {
    execFile(
      program,
      args,
      { timeout: TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => {
        resolve({ ok: error === null, stdout });
      },
    );
  });

export const MIN_NODE = [24, 20] as const;

export const checkNode = (version: string): CheckResult => {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [minMajor, minMinor] = MIN_NODE;
  const ok = major > minMajor || (major === minMajor && minor >= minMinor);
  return ok
    ? { name: "node", status: "ok", detail: `v${version}` }
    : {
        name: "node",
        status: "fail",
        detail: `v${version}`,
        hint: `Ork needs Node ${MIN_NODE.join(".")} or later.`,
      };
};

export const checkGit = async (run: Exec): Promise<CheckResult[]> => {
  const version = await run("git", ["--version"]);
  if (!version.ok) {
    return [
      {
        name: "git",
        status: "fail",
        detail: "not found",
        hint: "Install git; Ork gives each writing node its own worktree.",
      },
    ];
  }
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"]);
  return [
    { name: "git", status: "ok", detail: firstLine(version.stdout) },
    inside.ok
      ? { name: "git repo", status: "ok", detail: "inside a work tree" }
      : {
          name: "git repo",
          status: "warn",
          detail: "not a git repository",
          hint: "Run Ork inside a git repository so nodes can use worktrees.",
        },
  ];
};

/**
 * Runs every check: Node and git, then every registered Claude driver and
 * integration (ADR-022). Node, git, and at least one driver are required;
 * integrations are optional.
 */
export const runChecks = async (
  run: Exec,
  env: Env,
  nodeVersion: string,
): Promise<{ results: CheckResult[]; ok: boolean }> => {
  const [git, drivers, tools] = await Promise.all([
    checkGit(run),
    Promise.all(CLAUDE_DRIVERS.map(d => d.doctor(run, env))),
    Promise.all(
      INTEGRATIONS.flatMap(i =>
        i.doctor === undefined ? [] : [i.doctor(run, env)],
      ),
    ),
  ]);
  const results = [checkNode(nodeVersion), ...git, ...drivers, ...tools];
  const anyDriver = drivers.some(d => d.status === "ok");
  const ok = anyDriver && !results.some(r => r.status === "fail");
  return { results, ok };
};
