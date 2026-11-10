/**
 * @file Experiments from the commands' side: `ork doctor`'s line (none, each
 *   source, the union, an unknown name as a failed check), and an unknown name
 *   refusing `ork validate` and `ork run`, against a project in a temp folder.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type Experiment,
  type HumanChannel,
  inRepoPlace,
  openStore,
} from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  experimentsCheck,
  loadWorkflow,
  runWorkflowFile,
} from "../src/index.ts";
import { openCodeReady, standInDrivers } from "./fixtures/drivers.ts";

const registry: readonly Experiment[] = [
  { name: "one", summary: "The first", spec: "specs/one.md" },
  { name: "two", summary: "The second", spec: "specs/two.md" },
];

const WORKFLOW = `schemaVersion: 1
name: tools
nodes:
  check: { type: tool.shell, command: "true" }
`;

const human: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: false, message: "no" }),
};

/** A project with a workflow, and `rules` as its `.ork/project.yaml` if any. */
const project = (rules?: string) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-exp-")));
  mkdirSync(path.join(root, ".ork"));
  writeFileSync(path.join(root, "tools.ork.yaml"), WORKFLOW);
  writeFileSync(
    path.join(root, ".ork", "project.yaml"),
    rules ?? "schemaVersion: 1\n",
  );
  return root;
};

const ONE = "schemaVersion: 1\nexperimental: [one]\n";
const TYPO = "schemaVersion: 1\nexperimental:\n  - typo\n";

const check = (rules?: string, value?: string) =>
  experimentsCheck(
    inRepoPlace(project(rules)),
    { ORK_EXPERIMENTAL: value },
    registry,
  );

/** An environment holding a secret, which records every look at it. */
const watchedEnv = () => {
  const reads: string[] = [];
  const env = new Proxy<Record<string, string | undefined>>(
    { ANTHROPIC_API_KEY: "sk-secret", ORK_EXPERIMENTAL: "one" },
    {
      get: (target, key) => {
        reads.push(String(key));
        return target[String(key)];
      },
      has: (target, key) => {
        reads.push(String(key));
        return Reflect.has(target, key);
      },
      ownKeys: target => {
        reads.push("(every key)");
        return Reflect.ownKeys(target);
      },
    },
  );
  return { env, reads };
};

const validated = (root: string): string[] =>
  loadWorkflow("tools.ork.yaml", root, undefined, []).report.diagnostics.map(
    d => d.message,
  );

const ran = async (root: string) => {
  const said: string[] = [];
  const say = (line: string) => {
    said.push(line);
  };
  const { exitCode } = await runWorkflowFile({
    file: "tools.ork.yaml",
    cwd: root,
    inputs: [],
    inPlace: true,
    json: false,
    runtime: () => Promise.resolve(createCliRuntime({ bin: "unused" })),
    driverChecks: openCodeReady,
    drivers: standInDrivers,
    human,
    store: openStore(":memory:"),
    home: path.join(root, "home"),
    out: say,
    err: say,
    installed: () => true,
  });
  return { exitCode, said: said.join("\n") };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ork doctor's experiments line", () => {
  it("says so when none is on", () => {
    expect(check()).toEqual({
      name: "experiments",
      status: "ok",
      detail: "none on",
    });
  });

  it("names where each came from", () => {
    expect(check(ONE).detail).toBe("one (project file)");
    expect(check(undefined, "one").detail).toBe("one (environment)");
  });

  it("gives the union with no name twice", () => {
    expect(check(ONE, "one,two").detail).toBe(
      "one (project file and environment), two (environment)",
    );
  });

  it("counts only the environment outside a project", () => {
    const place = inRepoPlace(mkdtempSync(path.join(tmpdir(), "ork-bare-")));
    expect(
      experimentsCheck(place, { ORK_EXPERIMENTAL: "two" }, registry).detail,
    ).toBe("two (environment)");
  });

  it("reads only ORK_EXPERIMENTAL from the environment, never a credential", () => {
    const { env, reads } = watchedEnv();
    const result = experimentsCheck(inRepoPlace(project()), env, registry);
    expect(reads).toEqual(["ORK_EXPERIMENTAL"]);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("fails the check on an unknown name from either source", () => {
    expect(check(TYPO, "nope")).toEqual({
      name: "experiments",
      status: "fail",
      detail:
        "unknown: `typo` (.ork/project.yaml:3:5), `nope` (ORK_EXPERIMENTAL)",
      hint: "Fix or remove the name. Known experiments: one, two.",
    });
  });
});

describe("an unknown experiment name", () => {
  it("fails ork validate, naming it, its source and the known names", () => {
    expect(validated(project(TYPO))).toEqual([
      ".ork/project.yaml:3:5: names an unknown experiment `typo`; known: none",
    ]);
    vi.stubEnv("ORK_EXPERIMENTAL", "nope");
    expect(validated(project())).toEqual([
      "ORK_EXPERIMENTAL names an unknown experiment `nope`; known: none",
    ]);
  });

  it("refuses ork run from the project file", async () => {
    const { exitCode, said } = await ran(project(TYPO));
    expect(exitCode).toBe(1);
    expect(said).toContain("names an unknown experiment `typo`");
  });

  it("refuses ork run from the environment", async () => {
    vi.stubEnv("ORK_EXPERIMENTAL", "nope");
    const { exitCode, said } = await ran(project());
    expect(exitCode).toBe(1);
    expect(said).toContain("ORK_EXPERIMENTAL names an unknown experiment");
  });
});

describe("with no experiment named", () => {
  it("validates as before", () => {
    expect(validated(project())).toEqual([]);
  });
});
