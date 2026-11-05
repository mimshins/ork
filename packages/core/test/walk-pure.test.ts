/**
 * @file Holds the walk to what it promises (RFC-009): walking every example
 *   writes no file and starts no process, because `startRun` given no workspace
 *   touches nothing.
 */

import type * as ChildProcess from "node:child_process";
import { spawnSync } from "node:child_process";
import type * as Fs from "node:fs";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseWorkflow } from "@krapht/ork-schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { compileWorkflow, walkWorkflow } from "../src/index.ts";

const { noted, touched, WRITES } = vi.hoisted(() => {
  const list: string[] = [];
  return {
    touched: list,
    noted:
      (name: string) =>
      (...args: unknown[]): void => {
        list.push(`${name} ${String(args[0])}`);
      },
    WRITES: [
      "appendFile",
      "appendFileSync",
      "copyFile",
      "copyFileSync",
      "cp",
      "cpSync",
      "createWriteStream",
      "mkdir",
      "mkdirSync",
      "mkdtemp",
      "mkdtempSync",
      "rename",
      "renameSync",
      "rm",
      "rmSync",
      "symlinkSync",
      "unlink",
      "unlinkSync",
      "writeFile",
      "writeFileSync",
    ],
  };
});

vi.mock("node:fs", async original => {
  const actual = await original<typeof Fs>();
  return {
    ...actual,
    ...Object.fromEntries(WRITES.map(name => [name, noted(name)])),
  };
});

vi.mock("node:child_process", async original => {
  const actual = await original<typeof ChildProcess>();
  return {
    ...actual,
    spawn: noted("spawn"),
    spawnSync: noted("spawnSync"),
    exec: noted("exec"),
    execSync: noted("execSync"),
    execFile: noted("execFile"),
    execFileSync: noted("execFileSync"),
    fork: noted("fork"),
  };
});

const examples = path.resolve(import.meta.dirname, "../../../examples");

const compile = (file: string) => {
  const parsed = parseWorkflow(readFileSync(path.join(examples, file), "utf8"));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const { graph } = compileWorkflow(parsed.workflow, {
    workflowDir: examples,
    projectRoot: examples,
  });
  if (graph === null) throw new Error(`${file} doesn't compile`);
  return graph;
};

const files = readdirSync(examples).filter(file => file.endsWith(".ork.yaml"));

describe("a walk touches nothing", () => {
  beforeEach(() => {
    touched.length = 0;
  });

  it("would notice a write or a process", () => {
    mkdirSync("/nowhere");
    spawnSync("nothing");
    expect(touched).toEqual(["mkdirSync /nowhere", "spawnSync nothing"]);
  });

  it.each(files)("%s writes no file and starts no process", async file => {
    const graph = compile(file);
    const result = await walkWorkflow(graph);
    expect(result.paths).toBeGreaterThan(0);
    expect(touched).toEqual([]);
  });
});
