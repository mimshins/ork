/**
 * @file Tests for what `ork init` says of drivers, and the starter it writes:
 *   the starter names no driver; the line names the one a run would take here,
 *   from `ork doctor`'s checks against a fake `exec` and environment, the
 *   project's default when it names one, or how to get one ready.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Env, Exec } from "@krapht/ork-integrations";
import { parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  initDriverLine,
  initProject,
  STARTER_FILE,
  validateFile,
} from "../src/index.ts";

const tempProject = () => mkdtempSync(path.join(tmpdir(), "ork-init-"));

/** A fake `exec`: maps "program arg arg" to stdout; anything else fails. */
const fakeExec =
  (outputs: Record<string, string>): Exec =>
  (program, args) => {
    const stdout = outputs[[program, ...args].join(" ")];
    return Promise.resolve(
      stdout === undefined ? { ok: false, stdout: "" } : { ok: true, stdout },
    );
  };

const claudeVersion = { "claude --version": "2.1.314 (Claude Code)\n" };

const LOGIN = fakeExec({
  ...claudeVersion,
  "claude auth status --json": JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
  }),
});

const LOGGED_OUT = fakeExec({
  ...claudeVersion,
  "claude auth status --json": JSON.stringify({ loggedIn: false }),
});

const NO_CLAUDE = fakeExec({});

const KEY: Env = { ANTHROPIC_API_KEY: "x" };

/** A project whose `.ork/project.yaml` holds `text`, if any. */
const projectWith = (text?: string): string => {
  const root = tempProject();
  mkdirSync(path.join(root, ".ork"), { recursive: true });
  writeFileSync(path.join(root, ".ork/project.yaml"), text ?? "");
  return root;
};

const DEFAULTS_SDK = "schemaVersion: 1\ndefaults:\n  driver: sdk\n";
const DEFAULTS_CLI = "schemaVersion: 1\ndefaults:\n  driver: cli\n";

/** What `ork init` would say, for a project, a fake `exec` and an env. */
const said = (run: Exec, env: Env, project?: string) =>
  initDriverLine(run, env, projectWith(project));

describe("what ork init says of drivers", () => {
  it.each([
    [
      "a claude login alone",
      LOGIN,
      {},
      undefined,
      "Runs use the driver that's ready when they start: cli here (2.1.314 (Claude Code), logged in (claude.ai)).",
    ],
    [
      "an API key alone",
      NO_CLAUDE,
      KEY,
      undefined,
      "Runs use the driver that's ready when they start: sdk here (ANTHROPIC_API_KEY is set).",
    ],
    [
      "Bedrock alone",
      LOGGED_OUT,
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      undefined,
      "Runs use the driver that's ready when they start: sdk here (Amazon Bedrock).",
    ],
    [
      "both",
      LOGIN,
      KEY,
      undefined,
      "Runs use the driver that's ready when they start: cli here (more than one is ready, and cli comes first).",
    ],
    [
      "a project default of sdk",
      LOGIN,
      KEY,
      DEFAULTS_SDK,
      "Runs use the sdk driver, .ork/project.yaml's default, unless a workflow names another.",
    ],
    [
      "a project default of cli, with only an API key",
      NO_CLAUDE,
      KEY,
      DEFAULTS_CLI,
      "Runs use the cli driver, .ork/project.yaml's default, unless a workflow names another.",
    ],
    [
      "neither, with claude logged out",
      LOGGED_OUT,
      {},
      undefined,
      "Runs use the driver that's ready when they start, and none is ready here yet: Run `claude auth login` yourself; Ork never handles your login.",
    ],
    [
      "neither, without claude",
      NO_CLAUDE,
      {},
      undefined,
      "Runs use the driver that's ready when they start, and none is ready here yet: Install Claude Code to use the CLI driver.",
    ],
  ])("with %s", async (_case, run, env, project, line) => {
    expect(await said(run, env, project)).toBe(line);
  });
});

/** The defaults of the starter written in `root`. */
const starterDefaults = (root: string) => {
  const parsed = parseWorkflow(
    readFileSync(path.join(root, STARTER_FILE), "utf8"),
  );
  return parsed.ok ? parsed.workflow.defaults : undefined;
};

describe("the starter", () => {
  it("names no driver, and validates", () => {
    const root = tempProject();
    initProject(root);
    expect(starterDefaults(root)).toEqual({
      model: "sonnet",
      isolation: "worktree",
    });
    expect(validateFile(STARTER_FILE, root).diagnostics).toEqual([]);
  });
});
