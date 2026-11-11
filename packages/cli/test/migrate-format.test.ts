/**
 * @file Tests for the workflow-format part of `ork migrate` (RFC-015): the
 *   renamed node types are rewritten in place, keeping comments, models are
 *   left alone, `--dry-run` writes nothing, an unparseable file is named and
 *   left as it is, and a second run changes nothing.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateHere, validateFile } from "../src/index.ts";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const OLD = `schemaVersion: 1
name: old
defaults:
  model: sonnet
nodes:
  build:
    type: claude.worker
    prompt: go
    model: deepseek/deepseek-v4.1-flash
  check:
    type: tool.shell
    command: ls
edges:
  - build -> check
`;

const COMMENTED =
  "# kept\nschemaVersion: 1\nname: c\nnodes:\n  a:\n    type: claude.worker # the builder\n    prompt: go\n";

const BROKEN = "schemaVersion: 1\nnodes: [\n  type: claude.worker\n";

const NEW = `agent.worker`;

const project = (files: Record<string, string>) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-mig-fmt-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, ".ork", "workflows", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
};

const read = (root: string, name: string) =>
  readFileSync(path.join(root, ".ork", "workflows", name), "utf8");

/** Runs `ork migrate` in `root` and returns what it printed. */
const migrate = async (root: string, dryRun = false) => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    lines.push(String(chunk).trimEnd());
    return true;
  });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  await migrateHere(
    root,
    { agents: false, dryRun, yes: true },
    openStore(":memory:"),
  );
  return lines;
};

describe("ork migrate (the workflow format)", () => {
  it("renames the node types, keeps the layout and leaves models alone", async () => {
    const root = project({ "old.ork.yaml": OLD });
    const lines = await migrate(root);
    const text = read(root, "old.ork.yaml");
    expect(lines).toContain(
      "  rename .ork/workflows/old.ork.yaml: claude.worker ×1",
    );
    expect(text).toContain(`type: ${NEW}`);
    expect(text).toContain("model: deepseek/deepseek-v4.1-flash");
    expect(text).toContain("model: sonnet");
    expect(
      validateFile(".ork/workflows/old.ork.yaml", root).diagnostics,
    ).toEqual([]);
  });

  it("keeps the comments of a file it rewrites", async () => {
    const root = project({ "c.ork.yaml": COMMENTED });
    await migrate(root);
    const text = read(root, "c.ork.yaml");
    expect(text).toContain("# kept");
    expect(text).toContain("type: agent.worker # the builder");
  });

  it("changes nothing on a second run", async () => {
    const root = project({ "old.ork.yaml": OLD });
    await migrate(root);
    const once = read(root, "old.ork.yaml");
    const lines = await migrate(root);
    expect(lines).toEqual(["Nothing to migrate."]);
    expect(read(root, "old.ork.yaml")).toBe(once);
  });

  it("with --dry-run shows the same lines and writes nothing", async () => {
    const root = project({ "old.ork.yaml": OLD });
    const lines = await migrate(root, true);
    expect(lines).toContain(
      "  rename .ork/workflows/old.ork.yaml: claude.worker ×1",
    );
    expect(read(root, "old.ork.yaml")).toBe(OLD);
  });

  it("names a file it cannot parse and leaves it untouched", async () => {
    const root = project({ "old.ork.yaml": OLD, "broken.ork.yaml": BROKEN });
    const lines = await migrate(root);
    expect(
      lines.some(l => l.startsWith("  skip   .ork/workflows/broken.ork.yaml:")),
    ).toBe(true);
    expect(read(root, "broken.ork.yaml")).toBe(BROKEN);
    expect(read(root, "old.ork.yaml")).toContain(`type: ${NEW}`);
  });

  it("leaves a project with nothing to rewrite alone", async () => {
    const root = project({});
    expect(await migrate(root)).toEqual(["Nothing to migrate."]);
  });
});
