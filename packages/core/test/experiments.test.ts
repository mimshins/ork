/**
 * @file Tests for the experiments registry: nothing on by default, the project
 *   file and the environment each turning a name on and together giving the
 *   union, an unknown name from either being an error that the checks on a
 *   workflow report, and the one place `ORK_EXPERIMENTAL` is read.
 */

import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkWorkflowText,
  type Experiment,
  EXPERIMENTS,
  experimentOffMessage,
  experimentOn,
  experimentsOn,
  inRepoPlace,
  loadProject,
} from "../src/index.ts";

const registry: readonly Experiment[] = [
  { name: "one", summary: "The first", spec: "specs/one.md" },
  { name: "two", summary: "The second", spec: "specs/two.md" },
];

const WORKFLOW = `schemaVersion: 1
name: tools
nodes:
  check: { type: tool.shell, command: "true" }
`;

const REPO = path.resolve(import.meta.dirname, "../../..");

/** A project whose `.ork/project.yaml` holds `text`. */
const projectWith = (text: string): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-exp-")));
  mkdirSync(path.join(root, ".ork"));
  writeFileSync(path.join(root, ".ork", "project.yaml"), text);
  return root;
};

const errorsIn = (root: string): string[] =>
  checkWorkflowText(WORKFLOW, {
    place: inRepoPlace(root),
    workflowDir: root,
    registered: [],
  }).diagnostics.map(d => `${d.code}: ${d.message}`);

const orkSources = (): string[] =>
  globSync("packages/*/src/**/*.{ts,tsx}", { cwd: REPO }).filter(file =>
    readFileSync(path.join(REPO, file), "utf8").includes("ORK_EXPERIMENTAL"),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("experiments", () => {
  it("has none on by default, and ships an empty registry", () => {
    expect(EXPERIMENTS).toEqual([]);
    expect(experimentsOn({ env: {}, registry })).toEqual({ ok: true, on: [] });
    expect(experimentOn("one", { env: {}, registry })).toBe(false);
  });

  it("turns a name on from the project file", () => {
    const project = { experimental: ["one"] };
    expect(experimentsOn({ env: {}, project, registry })).toEqual({
      ok: true,
      on: [{ name: "one", sources: ["project"] }],
    });
    expect(experimentOn("one", { env: {}, project, registry })).toBe(true);
    expect(experimentOn("two", { env: {}, project, registry })).toBe(false);
  });

  it("turns names on from the environment, ignoring spaces and empty items", () => {
    const env = { ORK_EXPERIMENTAL: " one, ,two,one," };
    expect(experimentsOn({ env, registry })).toEqual({
      ok: true,
      on: [
        { name: "one", sources: ["environment"] },
        { name: "two", sources: ["environment"] },
      ],
    });
  });

  it("gives the union of both, with no name twice", () => {
    const env = { ORK_EXPERIMENTAL: "one,two" };
    const project = { experimental: ["one", "one"] };
    expect(experimentsOn({ env, project, registry })).toEqual({
      ok: true,
      on: [
        { name: "one", sources: ["project", "environment"] },
        { name: "two", sources: ["environment"] },
      ],
    });
  });

  it("says where an unknown name came from, and the known names", () => {
    const state = experimentsOn({
      env: { ORK_EXPERIMENTAL: "nope" },
      project: { experimental: ["typo"] },
      where: at => `project.yaml@${at.join(".")}`,
      registry,
    });
    expect(state).toEqual({
      ok: false,
      unknown: [
        {
          name: "typo",
          source: "project",
          where: "project.yaml@experimental.0",
          message:
            "project.yaml@experimental.0: names an unknown experiment `typo`; known: one, two",
        },
        {
          name: "nope",
          source: "environment",
          where: "ORK_EXPERIMENTAL",
          message:
            "ORK_EXPERIMENTAL names an unknown experiment `nope`; known: one, two",
        },
      ],
    });
  });

  it("keeps every gate off while a name is unknown", () => {
    const env = { ORK_EXPERIMENTAL: "one,typo" };
    expect(experimentOn("one", { env, registry })).toBe(false);
  });

  it("words a gate's message from the registry entry", () => {
    expect(experimentOffMessage("one", registry)).toBe(
      'one is experimental; turn it on with "experimental: [one]" in .ork/project.yaml or ORK_EXPERIMENTAL=one',
    );
    expect(() => experimentOffMessage("nope", registry)).toThrow(
      "`nope` is not in the experiments registry",
    );
  });

  it("is an error on a workflow, located in the project file", () => {
    const root = projectWith("schemaVersion: 1\nexperimental:\n  - typo\n");
    expect(errorsIn(root)).toEqual([
      "experiment.unknown: .ork/project.yaml:3:5: names an unknown experiment `typo`; known: none",
    ]);
    expect(loadProject(root).project?.experimental).toEqual(["typo"]);
  });

  it("is an error on a workflow from the environment", () => {
    vi.stubEnv("ORK_EXPERIMENTAL", "typo");
    expect(errorsIn(projectWith("schemaVersion: 1\n"))).toEqual([
      "experiment.unknown: ORK_EXPERIMENTAL names an unknown experiment `typo`; known: none",
    ]);
  });

  it("is read in one place", () => {
    expect(orkSources()).toEqual(["packages/core/src/experiments.ts"]);
  });
});
