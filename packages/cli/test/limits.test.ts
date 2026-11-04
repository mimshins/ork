/**
 * @file Limits across runs from the command's side (RFC-007): a spent quota
 *   stops a run from starting, a tool-only workflow still runs, a resume goes
 *   on once it is raised, and settings that can't be read refuse rather than
 *   spend.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type HumanChannel, inRepoPlace, openStore } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import { runWorkflowFile } from "../src/index.ts";
import { limitsHere, runLimits } from "../src/run/limits.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const SESSION = `schemaVersion: 1
name: spends
nodes:
  write: { type: claude.worker, isolation: shared, prompt: Write }
`;

const TOOLS = `schemaVersion: 1
name: tools
nodes:
  check: { type: tool.shell, command: "true" }
`;

const recommending: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

const setup = () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-limits-")));
  const home = mkdtempSync(path.join(tmpdir(), "ork-home-"));
  mkdirSync(path.join(home, ".ork"));
  writeFileSync(path.join(dir, "spends.ork.yaml"), SESSION);
  writeFileSync(path.join(dir, "tools.ork.yaml"), TOOLS);
  const store = openStore(":memory:");
  const settings = (text: string) => {
    writeFileSync(path.join(home, ".ork", "settings.yaml"), text);
  };
  const rules = (text: string) => {
    mkdirSync(path.join(dir, ".ork"), { recursive: true });
    writeFileSync(path.join(dir, ".ork", "project.yaml"), text);
  };
  const run = async (file: string) => {
    const said: string[] = [];
    const finished = await runWorkflowFile({
      file,
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
      human: recommending,
      store,
      home,
      out: line => {
        said.push(line);
      },
      err: line => {
        said.push(line);
      },
      installed: () => true,
    });
    return { ...finished, said: said.join("\n") };
  };
  return { dir, home, store, settings, rules, run };
};

describe("limits across runs", () => {
  it("changes nothing with none set", async () => {
    const { run } = setup();
    const { exitCode } = await run("spends.ork.yaml");
    expect(exitCode).toBe(0);
  });

  it("does not start once what earlier runs spent reaches the cap", async () => {
    const { run, settings, store } = setup();
    settings("schemaVersion: 1\nquotas: { dayUsd: 0.001 }\n");
    expect((await run("spends.ork.yaml")).exitCode).toBe(0);
    const refused = await run("spends.ork.yaml");
    expect(refused.exitCode).toBe(1);
    expect(refused.said).toContain("Not started: your day quota of $0.0010");
    expect(store.runs()).toHaveLength(1);
  });

  it("holds to a project's cap too", async () => {
    const { run, rules } = setup();
    rules("schemaVersion: 1\nquotas: { monthUsd: 0.001 }\n");
    await run("spends.ork.yaml");
    const refused = await run("spends.ork.yaml");
    expect(refused.said).toContain("this project's month quota");
  });

  it("still runs a workflow that spends nothing", async () => {
    const { run, settings } = setup();
    settings("schemaVersion: 1\nquotas: { dayUsd: 0.001 }\n");
    await run("spends.ork.yaml");
    expect((await run("tools.ork.yaml")).exitCode).toBe(0);
  });

  it("goes on once the cap is raised", async () => {
    const { run, settings } = setup();
    settings("schemaVersion: 1\nquotas: { dayUsd: 0.001 }\n");
    await run("spends.ork.yaml");
    settings("schemaVersion: 1\nquotas: { dayUsd: 5 }\n");
    expect((await run("spends.ork.yaml")).exitCode).toBe(0);
  });

  it("refuses settings it can't read, rather than dropping a cap", async () => {
    const { run, settings } = setup();
    settings("schemaVersion: 1\nquotas: { daily: 5 }\n");
    const refused = await run("spends.ork.yaml");
    expect(refused.exitCode).toBe(1);
    expect(refused.said).toContain("~/.ork/settings.yaml");
  });

  it("takes an empty settings file as no settings", async () => {
    const { run, settings } = setup();
    settings("# nothing yet\n\n");
    expect((await run("spends.ork.yaml")).exitCode).toBe(0);
  });

  it("lets a workflow of only tools run past settings it can't read", async () => {
    const { run, settings } = setup();
    settings("schemaVersion: 1\nquotas: { daily: 5 }\n");
    expect((await run("tools.ork.yaml")).exitCode).toBe(0);
  });

  it("reads a cap changed during a run, and keeps the last good one", () => {
    const { settings, store, home, dir } = setup();
    const place = inRepoPlace(dir);
    settings("schemaVersion: 1\nquotas: { dayUsd: 5 }\n");
    const limits = runLimits(store, place, home);
    expect(limits.now().leftUsd).toBe(5);
    settings("schemaVersion: 1\nquotas: { dayUsd: 9 }\n");
    expect(limits.now().leftUsd).toBe(9);
    settings("schemaVersion: 1\nquotas: { daily: 1 }\n");
    expect(limits.now().leftUsd).toBe(9);
  });

  it("says when settings can't be read, in what it reports", () => {
    const { settings, store, home } = setup();
    settings("schemaVersion: 1\nquotas: { daily: 5 }\n");
    expect(limitsHere(store, undefined, home).problems[0]).toContain(
      "~/.ork/settings.yaml",
    );
  });

  it("reports each cap with what it has left", async () => {
    const { run, settings, store, home, dir } = setup();
    settings("schemaVersion: 1\nquotas: { dayUsd: 5 }\n");
    await run("spends.ork.yaml");
    const { caps } = limitsHere(
      store,
      { root: dir, mode: "in-repo", dir: path.join(dir, ".ork") },
      home,
    );
    expect(caps).toMatchObject([{ window: "day", capUsd: 5 }]);
    expect(caps[0]?.spentUsd).toBeGreaterThan(0);
  });
});
