/**
 * @file Tests for what a node's session loads (`explainSession`,
 *   `explainWorkflowText`): each skill's layer and state, the context files,
 *   the instruction files and the appended prompt, with their words only when
 *   asked, and the planner's refusals.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkWorkflowText,
  estimateTokens,
  explainSession,
  explainWorkflowText,
  placeFor,
  type ProjectPlace,
  workflowDirOf,
} from "../src/index.ts";

const write = (root: string, file: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

const WORKFLOW = [
  "schemaVersion: 1",
  "name: t",
  "layers:",
  "  skills: [./skills/review]",
  "  context: [./style.md]",
  "nodes:",
  "  fix:",
  "    type: agent.worker",
  "  run:",
  "    type: tool.shell",
  '    command: "true"',
  '    allow: ["true"]',
  "",
].join("\n");

/** A project with a project skill the workflow's own skill shadows. */
const project = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-explain-")));
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  write(root, "AGENTS.md", "# Agents\n");
  write(
    root,
    ".claude/skills/review/SKILL.md",
    "---\nname: review\n---\nproject\n",
  );
  write(
    root,
    ".ork/workflows/skills/review/SKILL.md",
    "---\nname: review\n---\nours\n",
  );
  write(root, ".ork/workflows/style.md", "Be brief.\n");
  write(root, ".ork/workflows/t.ork.yaml", WORKFLOW);
  return {
    file: path.join(root, ".ork/workflows/t.ork.yaml"),
    home: path.join(base, "home"),
  };
};

/** An attached project (ADR-035): its repository, its folder under a home. */
const attachedPlace = () => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-explain-")));
  const root = path.join(home, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  const dir = path.join(home, ".ork", "projects", "app");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  const place: ProjectPlace = { id: "app", root, mode: "attached", dir };
  return { place, home };
};

/** A workflow whose only reference is a context file beside it. */
const BUNDLED = [
  "schemaVersion: 1",
  "name: x",
  "layers:",
  "  context: [./style.md]",
  "nodes:",
  "  fix:",
  "    type: agent.worker",
  "",
].join("\n");

/** `fix` of `BUNDLED` explained as the file `<place.dir>/<relative>`. */
const explainedAt = (place: ProjectPlace, home: string, relative: string) => {
  const file = path.join(place.dir, relative);
  write(place.dir, relative, BUNDLED);
  return explainWorkflowText(BUNDLED, file, "fix", {
    registered: [place],
    home,
  });
};

/** A result's sources and refusal, empty where it has none. */
const said = (result: ReturnType<typeof explainWorkflowText>) =>
  result.ok
    ? { sources: result.sources, error: "" }
    : { sources: [], error: result.error };

/** The explanation of `node` in `text`, or the refusal as an error. */
const explained = (text: string, node = "fix") => {
  const { file, home } = project();
  const result = explainWorkflowText(text, file, node, {
    registered: [],
    home,
  });
  if (!result.ok) throw new Error(result.error);
  return result.explanation;
};

/** The refusal for `node` in `text`. */
const refusal = (text: string, node: string) => {
  const { file, home } = project();
  const result = explainWorkflowText(text, file, node, {
    registered: [],
    home,
  });
  return result.ok ? "" : result.error;
};

/** `fix` planned straight from the compiled workflow, with no texts asked. */
const withoutTexts = () => {
  const { file, home } = project();
  const place = placeFor(path.dirname(file), []);
  const workflowDir = workflowDirOf(place, file);
  const { workflow, graph } = checkWorkflowText(WORKFLOW, {
    place,
    workflowDir,
    registered: [],
    home,
  });
  if (workflow === null) throw new Error("the fixture has errors");
  return explainSession(workflow, graph, "fix", {
    root: place.root,
    orkDir: place.dir,
    workflowDir,
    home,
  });
};

describe("what a node's session loads", () => {
  it("gives each skill's layer, state and words", () => {
    expect(
      explained(WORKFLOW).skills.map(s => [s.name, s.layer, s.state, s.text]),
    ).toEqual([
      ["review", "project", "off", "---\nname: review\n---\nproject\n"],
      ["ork:review", "workflow", "live", "---\nname: review\n---\nours\n"],
    ]);
  });

  it("gives the context files, the instruction file and the whole appended prompt", () => {
    const e = explained(WORKFLOW);
    expect(e.files).toEqual([
      {
        layer: "workflow",
        name: ".ork/workflows/style.md",
        tokens: estimateTokens("Be brief.\n"),
        text: "Be brief.\n",
      },
    ]);
    expect(e.instructionFiles).toEqual([
      {
        name: "AGENTS.md",
        tokens: estimateTokens("# Agents\n"),
        text: "# Agents\n",
      },
    ]);
    expect(e.appended).toContain("Be brief.");
    expect(e.appendedTokens).toBe(estimateTokens(String(e.appended)));
  });

  it("follows the text it's given, saved or not", () => {
    const drafted = WORKFLOW.replace(
      "  context: [./style.md]",
      "  context: [./style.md, ../../AGENTS.md]",
    );
    expect(explained(drafted).files.map(f => f.name)).toEqual([
      ".ork/workflows/style.md",
      "AGENTS.md",
    ]);
  });

  it("leaves the words out unless asked", () => {
    const result = withoutTexts();
    expect(JSON.stringify(result)).not.toContain("Be brief.");
    expect(result).toMatchObject({ ok: true, explanation: { node: "fix" } });
  });

  it("names the files and folders behind the stack", () => {
    const { file, home } = project();
    write(home, ".ork/context/notes.md", "Mine.\n");
    write(
      path.dirname(file),
      "../agents/fixer.md",
      "---\nname: fixer\ndescription: Fixes.\n---\nFix it.\n",
    );
    const result = explainWorkflowText(
      WORKFLOW.replace(
        "    type: agent.worker",
        "    type: agent.worker\n    agent: fixer",
      ),
      file,
      "fix",
      { registered: [], home },
    );
    const root = path.dirname(path.dirname(path.dirname(file)));
    expect(result).toMatchObject({
      ok: true,
      sources: [
        path.join(root, ".ork/agents/fixer.md"),
        path.join(root, ".ork/agents/fixer.agent.yaml"),
        path.join(root, ".ork/project.yaml"),
        path.join(root, "AGENTS.md"),
        path.join(root, ".claude/skills/review/SKILL.md"),
        path.join(root, ".ork/workflows/skills/review/SKILL.md"),
        path.join(home, ".ork/context/notes.md"),
        path.join(root, ".ork/workflows/style.md"),
        path.join(home, ".ork/context"),
        path.join(home, ".ork/skills"),
        path.join(root, ".claude/skills"),
      ],
    });
  });

  it("names each practice by its own words, with one switched off", () => {
    const e = explained(
      WORKFLOW.replace(
        "nodes:\n",
        "defaults:\n  practices: { caveman: false }\nnodes:\n",
      ),
    );
    expect(e.practices.map(p => p.name)).toEqual(["ponytail"]);
    expect(e.practices[0]?.text).toContain("ponytail");
  });

  it("plans a worker spawned in a run as the node it came from", () => {
    expect(explained(WORKFLOW, "fix-2")).toMatchObject({
      node: "fix-2",
      template: "fix",
      type: "agent.worker",
    });
  });

  it("plans an item of a fanned node as the node it is of", () => {
    expect(explained(WORKFLOW, "fix.2")).toMatchObject({
      node: "fix.2",
      template: "fix",
      type: "agent.worker",
    });
  });

  it("reads an attached built-in bundle's references from its own folder", () => {
    const { place, home } = attachedPlace();
    const folder = path.join(place.dir, "runs", ".builtin", "0123456789ab");
    write(folder, "style.md", "Be brief.\n");
    const result = explainedAt(
      place,
      home,
      "runs/.builtin/0123456789ab/x.ork.yaml",
    );
    expect(result).toMatchObject({
      ok: true,
      explanation: { files: [{ layer: "workflow", text: "Be brief.\n" }] },
    });
    expect(said(result).sources).toContain(path.join(folder, "style.md"));
  });

  it("refuses the same file outside the bundle folder, where its reference is missing", () => {
    const { place, home } = attachedPlace();
    write(
      path.join(place.dir, "runs", ".builtin", "0123456789ab"),
      "style.md",
      "Be brief.\n",
    );
    const result = explainedAt(place, home, "workflows/x.ork.yaml");
    expect(result.ok).toBe(false);
    expect(said(result).error).toMatch(/\.\/style\.md does not exist$/u);
  });

  it("says why a node can't be planned", () => {
    expect(refusal(WORKFLOW, "nope")).toBe("unknown node `nope`");
    expect(refusal(WORKFLOW, "run")).toBe(
      "`run` is a `tool.shell`, not a Claude node",
    );
    expect(refusal("schemaVersion: 1\nname: t\nnodes: {}\n", "fix")).toMatch(
      /^The workflow has errors, so it can't be planned/u,
    );
  });
});
