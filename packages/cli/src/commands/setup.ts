/**
 * @file Setting up: `ork init` scaffolds `.ork/` in a project with a starter
 *   workflow and the `.gitignore` entry for run state, never overwriting a
 *   file; `ork doctor` prints the environment checks (Node, git, and the user's
 *   own claude, gh and aws logins) and fails when no Claude driver can run. Ork
 *   stores no credentials.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CheckResult } from "@krapht/ork-integrations";
import { serializeWorkflow, type Workflow } from "@krapht/ork-schema";
import { defineCommand } from "citty";

import { exec, runChecks } from "../doctor/checks.ts";
import { style, write } from "../output.ts";
import { WORKFLOW_DIR, WORKFLOW_SUFFIX } from "../workflows.ts";

/** Run state that never belongs in git. */
export const GITIGNORE_ENTRIES = [".ork/runs/"] as const;

export const STARTER: Workflow = {
  schemaVersion: 1,
  name: "hello",
  description:
    "A leader plans the task, a worker does it, and you approve the result.",
  inputs: {
    task: { type: "string", required: true, description: "What to do." },
  },
  defaults: { driver: "sdk", model: "sonnet", isolation: "worktree" },
  limits: { budgetUsd: 5 },
  nodes: {
    lead: {
      type: "claude.leader",
      prompt: "Plan this task and delegate it to your worker: {{inputs.task}}",
      model: "opus",
      maxWorkers: 2,
    },
    worker: {
      type: "claude.worker",
      parent: "lead",
      prompt: "Do the part of the task your owner gives you, then report.",
    },
    approve: {
      type: "human.gate",
      question: "Accept the result on {{nodes.lead.output.branch}}?",
      options: ["accept", "reject"],
      recommended: "accept",
    },
  },
  edges: ["lead -> approve"],
};

export type InitResult = { created: string[]; skipped: string[] };

/** Scaffolds `.ork/` in `cwd`. Never overwrites an existing file. */
export const initProject = (cwd: string): InitResult => {
  const created: string[] = [];
  const skipped: string[] = [];

  mkdirSync(path.join(cwd, WORKFLOW_DIR), { recursive: true });
  const starter = path.join(WORKFLOW_DIR, `${STARTER.name}${WORKFLOW_SUFFIX}`);
  if (existsSync(path.join(cwd, starter))) {
    skipped.push(starter);
  } else {
    writeFileSync(path.join(cwd, starter), serializeWorkflow(STARTER));
    created.push(starter);
  }

  const gitignore = path.join(cwd, ".gitignore");
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  const lines = new Set(current.split("\n").map(line => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter(entry => !lines.has(entry));
  if (missing.length > 0) {
    const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
    writeFileSync(
      gitignore,
      `${current}${prefix}# Ork run state\n${missing.join("\n")}\n`,
    );
    created.push(`.gitignore (${missing.join(", ")})`);
  }
  return { created, skipped };
};

export const init = defineCommand({
  meta: {
    name: "init",
    description: "Set up .ork/ in this project with a starter workflow",
  },
  run: () => {
    const { created, skipped } = initProject(process.cwd());
    for (const item of created) write(`${style("green", "created")} ${item}`);
    for (const item of skipped) write(`${style("dim", "exists")}  ${item}`);
    write(
      `\nNext: edit ${WORKFLOW_DIR}/, then run ${style("bold", "ork validate")}.`,
    );
  },
});

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
