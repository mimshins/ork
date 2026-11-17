/**
 * @file Tests for a built-in bundle: companion files are written beside the
 *   workflow under one hash of them all, carry the bundle's folder relative to
 *   the project root, are left alone when unchanged, and a link or a folder on
 *   any of their paths is refused with nothing written or removed.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  builtinBundleUnder,
  builtinProblem,
  builtinWorkflowFile,
  BUNDLE_DIR_PLACEHOLDER,
  inRepoPlace,
  type ProjectPlace,
} from "../src/index.ts";
import { BUILTIN_WORKFLOWS } from "../src/project/builtin-workflows.ts";

/** The companions `ork:feedback-apply` gets here; a test may change one. */
const companions = vi.hoisted(() => ({
  "skill/phase.md": "Read the phase.\n",
  "tools/run.ts": "node __ORK_BUNDLE_DIR__/tools/run.ts\n",
}));

vi.mock("../src/project/builtin-bundles.ts", () => ({
  BUILTIN_FILES: { "feedback-apply": companions },
}));

const NAME = "ork:feedback-apply";

/** A project with a git folder, in a fresh temporary folder. */
const project = () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-bundle-")));
  const root = path.join(base, "app");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  return { base, root, place: inRepoPlace(root) };
};

/** The bundle's written folder in a new project, failing when none is. */
const written = () => {
  const { root, place } = project();
  const file = builtinWorkflowFile(place, NAME);
  if (file === undefined) throw new Error("No bundle written.");
  const folder = path.dirname(file);
  return { root, place, file, folder };
};

/** The bundle's workflow file under `root`, failing when none is written. */
const writtenUnder = (root: string): string => {
  const result = builtinBundleUnder(root, NAME);
  if (!result.ok) throw new Error(result.error);
  return result.file;
};

/** The bundle's workflow file in an attached `place`, failing when none. */
const writtenIn = (place: ProjectPlace): string => {
  const file = builtinWorkflowFile(place, NAME);
  if (file === undefined) throw new Error("No bundle written.");
  return file;
};

/** The error of a refused write under `root`, failing when it wrote. */
const refusedUnder = (root: string): string => {
  const result = builtinBundleUnder(root, NAME);
  if (result.ok) throw new Error("A bundle was written.");
  return result.error;
};

describe("a built-in bundle", () => {
  it("writes the workflow and every companion into one hash folder", () => {
    const { root, file, folder } = written();
    expect(path.relative(root, folder)).toMatch(
      /^\.ork\/runs\/\.builtin\/[0-9a-f]{12}$/u,
    );
    expect(readFileSync(file, "utf8")).toBe(
      BUILTIN_WORKFLOWS["feedback-apply"],
    );
    expect(readFileSync(path.join(folder, "skill/phase.md"), "utf8")).toBe(
      "Read the phase.\n",
    );
  });

  it("replaces the placeholder with the folder relative to the root", () => {
    const { root, folder } = written();
    const shown = path.relative(root, folder);
    expect(BUNDLE_DIR_PLACEHOLDER).toBe("__ORK_BUNDLE_DIR__");
    expect(readFileSync(path.join(folder, "tools/run.ts"), "utf8")).toBe(
      `node ${shown}/tools/run.ts\n`,
    );
  });

  it("gives a new folder when a companion changes", () => {
    const { root, folder } = written();
    const before = companions["skill/phase.md"];
    companions["skill/phase.md"] = "Read the new phase.\n";
    const changed = written();
    companions["skill/phase.md"] = before;
    expect(path.relative(changed.root, changed.folder)).not.toBe(
      path.relative(root, folder),
    );
  });

  it("doesn't rewrite an unchanged file, and rewrites a changed one", () => {
    const { place, file, folder } = written();
    const phase = path.join(folder, "skill/phase.md");
    const inode = statSync(phase).ino;
    expect(builtinWorkflowFile(place, NAME)).toBe(file);
    expect(statSync(phase).ino).toBe(inode);
    writeFileSync(phase, "changed by hand\n");
    expect(builtinWorkflowFile(place, NAME)).toBe(file);
    expect(readFileSync(phase, "utf8")).toBe("Read the phase.\n");
  });

  it("refuses a link on a companion's path, and writes nothing", () => {
    const { root, folder } = written();
    const at = project();
    const elsewhere = path.join(at.base, "elsewhere");
    mkdirSync(elsewhere);
    const there = path.join(at.root, path.relative(root, folder));
    mkdirSync(there, { recursive: true });
    symlinkSync(elsewhere, path.join(there, "skill"));
    expect(builtinProblem(at.place, NAME)).toMatch(
      /^`\.ork\/runs\/\.builtin\/[0-9a-f]{12}\/skill\/phase\.md` is a link, or behind one/u,
    );
    expect(builtinWorkflowFile(at.place, NAME)).toBeUndefined();
    expect(existsSync(path.join(there, "feedback-apply.ork.yaml"))).toBe(false);
    expect(existsSync(path.join(there, "tools"))).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("writes under a given root, byte-identical to an attached project's copy", () => {
    const at = project();
    const home = path.join(at.base, "home");
    const attached = {
      root: at.root,
      mode: "attached" as const,
      dir: path.join(home, "projects", "p1"),
    };
    const recorded = writtenIn(attached);
    const worktree = path.join(at.base, "worktree");
    mkdirSync(worktree);
    const folder = path.dirname(writtenUnder(worktree));
    expect(path.relative(worktree, folder)).toMatch(
      /^\.ork\/runs\/\.builtin\/[0-9a-f]{12}$/u,
    );
    expect(path.basename(folder)).toBe(path.basename(path.dirname(recorded)));
    for (const file of ["feedback-apply.ork.yaml", "tools/run.ts"]) {
      expect(readFileSync(path.join(folder, file), "utf8")).toBe(
        readFileSync(path.join(path.dirname(recorded), file), "utf8"),
      );
    }
    expect(readFileSync(path.join(folder, "tools/run.ts"), "utf8")).toBe(
      `node .ork/runs/.builtin/${path.basename(folder)}/tools/run.ts\n`,
    );
  });

  it("refuses a link on a path under a given root, and writes nothing", () => {
    const { root, folder } = written();
    const at = project();
    const elsewhere = path.join(at.base, "elsewhere");
    mkdirSync(elsewhere);
    const there = path.join(at.root, path.relative(root, folder));
    mkdirSync(there, { recursive: true });
    symlinkSync(elsewhere, path.join(there, "skill"));
    expect(refusedUnder(at.root)).toMatch(/is a link, or behind one/u);
    expect(existsSync(path.join(there, "feedback-apply.ork.yaml"))).toBe(false);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses a root that is itself a link, and writes nothing", () => {
    const at = project();
    const link = path.join(at.base, "link");
    symlinkSync(at.root, link);
    expect(refusedUnder(link)).toMatch(/is a link/u);
    expect(existsSync(path.join(at.root, ".ork"))).toBe(false);
  });

  it("refuses a folder at a companion's path, and removes nothing", () => {
    const { root, place, folder } = written();
    const run = path.join(folder, "tools/run.ts");
    rmSync(run);
    mkdirSync(run);
    writeFileSync(path.join(run, "mine.txt"), "keep\n");
    writeFileSync(path.join(folder, "skill/phase.md"), "changed by hand\n");
    expect(builtinProblem(place, NAME)).toBe(
      `\`${path.relative(root, run)}\` is a folder, not a file: Ork writes its own workflow there, so it wrote nothing.`,
    );
    expect(builtinWorkflowFile(place, NAME)).toBeUndefined();
    expect(readFileSync(path.join(run, "mine.txt"), "utf8")).toBe("keep\n");
    expect(readFileSync(path.join(folder, "skill/phase.md"), "utf8")).toBe(
      "changed by hand\n",
    );
  });
});
