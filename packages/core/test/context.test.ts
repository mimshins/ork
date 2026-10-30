/**
 * @file Tests for the context compiler on fixture folders: layer precedence and
 *   shadowing, `project.skills`, reference diagnostics, the order of context
 *   files, and what a planned session gets (sections, plugin, settings).
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, type Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import {
  contextDiagnostics,
  planNodeSession,
  projectRootOf,
  resolveContext,
  sessionSettings,
} from "../src/index.ts";

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

const skill = (root: string, dir: string, name?: string) => {
  write(
    root,
    `${dir}/SKILL.md`,
    `---\n${name === undefined ? "" : `name: ${name}\n`}description: d\n---\nbody of ${dir}\n`,
  );
};

/** A project with skills in every layer, and a home with the user layer. */
const fixture = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-ctx-")));
  const root = path.join(base, "app");
  const home = path.join(base, "home");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  skill(home, ".ork/skills/alpha");
  skill(home, ".ork/skills/solo");
  write(home, ".ork/context/b-mine.md", "user b\n");
  write(home, ".ork/context/a-mine.md", "user a\n");
  skill(root, ".claude/skills/alpha");
  skill(root, ".claude/skills/beta");
  skill(root, ".claude/skills/gamma-dir", "gamma");
  skill(root, ".ork/workflows/skills/beta");
  skill(root, ".ork/workflows/node-skills/gamma");
  write(root, ".ork/workflows/context/style.md", "workflow style\n");
  write(root, ".ork/workflows/context/fix.md", "node notes\n");
  write(root, ".ork/lessons/t.md", "lesson one\n");
  return { root, home, workflowDir: path.join(root, ".ork/workflows") };
};

const workflowOf = (lines: string[]): Workflow => {
  const parsed = parseWorkflow(
    ["schemaVersion: 1", "name: t", ...lines].join("\n"),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.workflow;
};

const LAYERED = [
  "layers:",
  "  skills: [./skills/beta]",
  "  context: [./context/style.md]",
  "nodes:",
  "  fix:",
  "    type: claude.worker",
  "    skills: [./node-skills/gamma]",
  "    context: [./context/fix.md]",
];

const resolve = (lines: string[]) => {
  const f = fixture();
  return {
    ...f,
    stack: resolveContext({
      workflow: workflowOf(lines),
      nodeId: "fix",
      workflowDir: f.workflowDir,
      projectRoot: f.root,
      checkout: f.root,
      home: f.home,
    }),
  };
};

const summary = (stack: ReturnType<typeof resolveContext>) =>
  stack.skills.map(
    s =>
      `${s.layer}:${s.name}${s.shadowedBy === undefined ? "" : ` < ${s.shadowedBy}`}${s.ignored === undefined ? "" : ` (${s.ignored})`}`,
  );

describe("the layer resolver", () => {
  it("lets the more local layer win each name, and loads it once", () => {
    const { stack } = resolve(LAYERED);
    expect(summary(stack)).toEqual([
      "user:alpha < project",
      "user:solo",
      "project:alpha",
      "project:beta < workflow",
      "project:gamma < node",
      "workflow:beta",
      "node:gamma",
    ]);
    expect(stack.plugin.map(s => `${s.layer}:${s.name}`)).toEqual([
      "user:solo",
      "workflow:beta",
      "node:gamma",
    ]);
    expect(stack.projectOff).toEqual(["beta", "gamma"]);
    expect(stack.diagnostics).toEqual([]);
  });

  it("orders context files user, workflow (then lessons), node", () => {
    const { stack } = resolve(LAYERED);
    expect(stack.files.map(f => `${f.layer} ${f.name}`)).toEqual([
      "user ~/.ork/context/a-mine.md",
      "user ~/.ork/context/b-mine.md",
      "workflow .ork/workflows/context/style.md",
      "workflow .ork/lessons/t.md",
      "node .ork/workflows/context/fix.md",
    ]);
  });

  it("switches off the project skills `project.skills` leaves out", () => {
    const allow = resolve([
      "layers:",
      "  project: { skills: { allow: [alpha, missing] } }",
      "nodes:",
      "  fix: { type: claude.worker }",
    ]);
    expect(allow.stack.projectOff).toEqual(["beta", "gamma"]);
    expect(
      allow.stack.diagnostics.map(d => `${d.severity} ${d.message}`),
    ).toEqual(['warning the project has no skill "missing"']);
    const ignore = resolve([
      "layers:",
      "  project: { skills: ignore, instructions: ignore }",
      "nodes:",
      "  fix: { type: claude.worker }",
    ]);
    expect(ignore.stack.projectOff).toEqual(["alpha", "beta", "gamma"]);
    // With the project's alpha ignored, the user's alpha is live again.
    expect(ignore.stack.plugin.map(s => s.name)).toEqual(["alpha", "solo"]);
    expect(sessionSettings(ignore.stack, ignore.root)).toEqual({
      skillOverrides: { alpha: "off", beta: "off", gamma: "off" },
      claudeMdExcludes: [
        path.join(ignore.root, "**/CLAUDE.md"),
        path.join(ignore.root, "**/CLAUDE.local.md"),
        path.join(ignore.root, ".claude/rules/**"),
      ],
      pluginConfigs: {
        "cc-plugin-agents-md@builtin": {
          options: { instructionFiles: "claude-md" },
        },
      },
    });
  });

  it("reports references that resolve to nothing, with their path", () => {
    const { stack } = resolve([
      "layers:",
      "  skills: [review, ork:nope, ./skills/none, ../../../outside, ./skills/beta, ./skills/beta]",
      "  context: [./context/missing.md]",
      "nodes:",
      "  fix: { type: claude.worker }",
    ]);
    expect(
      stack.diagnostics.map(d => `${d.code} ${d.path.join(".")}: ${d.message}`),
    ).toEqual([
      'ref.skill layers.skills.0: "review" is neither a built-in (ork:<name>) nor a path to a skill folder (./…); project skills load by themselves',
      'ref.skill layers.skills.1: Ork has no built-in skill "nope"',
      "ref.skill layers.skills.2: ./skills/none has no SKILL.md",
      "ref.skill layers.skills.3: ../../../outside is outside the project",
      'ref.skill layers.skills: two workflow skills are named "beta"',
      "ref.context layers.context.0: ./context/missing.md does not exist",
    ]);
  });

  it("checks a whole workflow once per finding, and finds the project root", () => {
    const f = fixture();
    const workflow = workflowOf([
      "layers:",
      "  context: [./context/missing.md]",
      "nodes:",
      "  a: { type: claude.worker }",
      "  b: { type: claude.worker }",
    ]);
    const found = contextDiagnostics(workflow, {
      workflowDir: f.workflowDir,
      projectRoot: f.root,
      home: f.home,
    });
    expect(found.map(d => d.code)).toEqual(["ref.context"]);
    expect(projectRootOf(path.join(f.root, ".ork/workflows"))).toBe(f.root);
  });
});

/** A planned session's spec, or the planning error thrown. */
const plannedSpec = (...args: Parameters<typeof planNodeSession>) => {
  const plan = planNodeSession(...args);
  if (!plan.ok) throw new Error(plan.error);
  return plan.spec;
};

describe("a planned session", () => {
  it("gets the context sections in cache order, its plugin, and its settings", () => {
    const f = fixture();
    const spec = plannedSpec(
      workflowOf([
        ...LAYERED.slice(0, 3),
        "defaults: { practices: { caveman: false, ponytail: false } }",
        ...LAYERED.slice(3),
      ]),
      "fix",
      {
        cwd: f.root,
        inputs: {},
        inPlace: true,
        workflowDir: f.workflowDir,
        projectRoot: f.root,
        pluginDir: path.join(f.root, ".ork/runs/r1/plugins/fix"),
        home: f.home,
      },
    );
    const { systemAppend, plugins, settings } = spec;
    const order = [
      "# Your context",
      "# Workflow context",
      "# Ork",
      "# Context for this node",
    ];
    expect(order.map(h => systemAppend.indexOf(h))).toEqual(
      order.map(h => systemAppend.indexOf(h)).toSorted((a, b) => a - b),
    );
    expect(systemAppend).toContain("## .ork/lessons/t.md\n\nlesson one");

    const dir = path.join(f.root, ".ork/runs/r1/plugins/fix");
    expect(plugins).toEqual([dir]);
    expect(
      JSON.parse(
        readFileSync(path.join(dir, ".claude-plugin/plugin.json"), "utf8"),
      ),
    ).toMatchObject({ name: "ork" });
    expect(
      ["solo", "beta", "gamma"].map(n =>
        existsSync(path.join(dir, "skills", n, "SKILL.md")),
      ),
    ).toEqual([true, true, true]);
    expect(settings).toEqual({ skillOverrides: { beta: "off", gamma: "off" } });
  });

  it("fails a node whose references resolve to nothing", () => {
    const f = fixture();
    const plan = planNodeSession(
      workflowOf([
        "nodes:",
        "  fix: { type: claude.worker, skills: [ork:nope] }",
      ]),
      "fix",
      {
        cwd: f.root,
        inputs: {},
        inPlace: true,
        projectRoot: f.root,
        home: f.home,
      },
    );
    expect(plan).toEqual({
      ok: false,
      error: 'Ork has no built-in skill "nope"',
    });
  });
});
