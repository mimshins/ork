/**
 * @file Tests for the writer's format reference of `ork:onboard-write`
 *   (`workflows/onboard-write/context/format.md`): its example workflow parses
 *   and checks with no error, it names every node type of the schema and the
 *   graph diagnostic about a missing entry, and the writer reads it as context;
 *   and the `finish` node's script, which passes `--base` only when the
 *   writer's worktree was seeded.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeSchema, parseWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { checkWorkflowText, inRepoPlace } from "../src/index.ts";
import { BUILTIN_FILES } from "../src/project/builtin-bundles.ts";
import { BUILTIN_WORKFLOWS } from "../src/project/builtin-workflows.ts";

const FORMAT = readFileSync(
  path.join(
    import.meta.dirname,
    "../workflows/onboard-write/context/format.md",
  ),
  "utf8",
);

/** The text of the one `yaml` block of the reference. */
const example = (): string => {
  const match = /```yaml\n([\s\S]*?)```/u.exec(FORMAT);
  if (match?.[1] === undefined) throw new Error("No yaml example.");
  return match[1];
};

/** The bundled `finish` node's script and env. */
const finishNode = (): { script: string; env: Record<string, string> } => {
  const parsed = parseWorkflow(BUILTIN_WORKFLOWS["onboard-write"] ?? "");
  const node = parsed.ok ? parsed.workflow.nodes["finish"] : undefined;
  if (node?.type !== "tool.shell") throw new Error("No finish node.");
  return { script: node.script ?? "", env: node.env ?? {} };
};

describe("the writer's format reference", () => {
  it("has an example that parses and checks with no error", () => {
    expect(parseWorkflow(example()).ok).toBe(true);
    const root = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), "ork-format-"))),
      "app",
    );
    mkdirSync(path.join(root, ".git"), { recursive: true });
    const { diagnostics } = checkWorkflowText(example(), {
      place: inRepoPlace(root),
      workflowDir: root,
      registered: [],
    });
    expect(diagnostics.filter(d => d.severity === "error")).toEqual([]);
  });

  it.each(NodeSchema.options.map(option => option.shape.type.value))(
    "names the node type %s",
    type => {
      expect(FORMAT).toContain(`\`${type}\``);
    },
  );

  it.each(["isolation", "maxRounds", "graph.no-entry", "budgetUsd"])(
    "explains %s",
    word => {
      expect(FORMAT).toContain(word);
    },
  );

  it("passes `--base` to finish only for a seeded run", () => {
    const { script, env } = finishNode();
    const echoed = (SEED: string): string =>
      execFileSync("sh", ["-c", script], {
        encoding: "utf8",
        env: { ORK_BIN: "/bin/echo", WORKTREE: "/w t", BRANCH: "b", SEED },
      }).trim();
    expect(echoed("")).toBe("__onboard finish --worktree /w t --branch b");
    expect(echoed("abc123")).toBe(
      "__onboard finish --worktree /w t --branch b --base abc123",
    );
    expect(env["SEED"]).toBe("{{nodes.write.output.seed}}");
  });

  it("is in the bundle, and the writer names it in its context", () => {
    expect(
      BUILTIN_FILES["onboard-write"]?.["onboard-write/context/format.md"],
    ).toBe(FORMAT);
    expect(BUILTIN_WORKFLOWS["onboard-write"]).toContain(
      "./onboard-write/context/format.md",
    );
  });
});
