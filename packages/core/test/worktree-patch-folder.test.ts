/**
 * @file Tests a worktree's changes applied to a folder that is not the checkout
 *   (`changesSince` with `relativeTo`, `applyChanges` into a plain folder): the
 *   attached-project onboard keep, which puts a writer's `.ork/workflows` files
 *   into `~/.ork/projects/<id>/` (RFC-022 option D).
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyChanges, changesSince } from "../src/worktree/patch.ts";
import { repo, sh, write } from "./fixtures/git.ts";

const folder = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-folder-")));

/** `applyChanges`' option for Ork's attached folder: a plain folder. */
const PLAIN = { plainFolder: true };

/** Every file under `root` with its text, to compare a folder before/after. */
const contents = (root: string, dir = ""): Record<string, string> =>
  Object.fromEntries(
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
      entry => {
        const relative = path.join(dir, entry.name);
        return entry.isDirectory()
          ? Object.entries(contents(root, relative))
          : [[relative, readFileSync(path.join(root, relative), "utf8")]];
      },
    ),
  );

/** A project at `app/` (a repo subfolder) with one workflow, committed. */
const project = (): string => {
  const root = repo();
  write(root, "app/.ork/workflows/a.ork.yaml", "name: a\n");
  write(root, "app/.ork/project.yaml", "context: []\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "project");
  return root;
};

/** The writer's change: edits `a`, adds `b` and a file outside `.ork/`. */
const writerPatch = (root: string): Promise<string> => {
  write(root, "app/.ork/workflows/a.ork.yaml", "name: a2\n");
  write(root, "app/.ork/workflows/b.ork.yaml", "name: b\n");
  write(root, "app/src/other.ts", "export {};\n");
  return changesSince(root, "HEAD", "app/.ork/");
};

/** The attached folder as the seed saw it. */
const attached = (): string => {
  const dir = folder();
  write(dir, "workflows/a.ork.yaml", "name: a\n");
  write(dir, "project.yaml", "context: []\n");
  return dir;
};

describe("changesSince relative to a folder", () => {
  it("names paths relative to it and leaves out files elsewhere", async () => {
    const patch = await writerPatch(project());
    expect(patch).toContain("b/workflows/b.ork.yaml");
    expect(patch).not.toContain("app/");
    expect(patch).not.toContain("other.ts");
  });

  it("is the whole change without it", async () => {
    const root = project();
    write(root, "app/src/other.ts", "export {};\n");
    expect(await changesSince(root, "HEAD")).toContain("app/src/other.ts");
  });
});

describe("applyChanges into a plain folder", () => {
  it("applies a modified and a new file, and nothing else", async () => {
    const dir = attached();
    const applied = await applyChanges(
      dir,
      await writerPatch(project()),
      PLAIN,
    );
    expect(applied).toEqual({ ok: true });
    expect(contents(dir)).toEqual({
      "workflows/a.ork.yaml": "name: a2\n",
      "workflows/b.ork.yaml": "name: b\n",
      "project.yaml": "context: []\n",
    });
  });

  it("creates a missing workflows folder itself", async () => {
    const dir = folder();
    const root = project();
    write(root, "app/.ork/workflows/c.ork.yaml", "name: c\n");
    const applied = await applyChanges(
      dir,
      await changesSince(root, "HEAD", "app/.ork/"),
      PLAIN,
    );
    expect(applied.ok).toBe(true);
    expect(contents(dir)).toEqual({ "workflows/c.ork.yaml": "name: c\n" });
  });

  it("applies relative to the folder even inside another repository", async () => {
    const outer = repo();
    const dir = path.join(outer, "nested");
    write(dir, "workflows/a.ork.yaml", "name: a\n");
    const applied = await applyChanges(
      dir,
      await writerPatch(project()),
      PLAIN,
    );
    expect(applied.ok).toBe(true);
    expect(contents(dir)).toEqual({
      "workflows/a.ork.yaml": "name: a2\n",
      "workflows/b.ork.yaml": "name: b\n",
    });
    expect(existsSync(path.join(outer, "workflows"))).toBe(false);
  });

  it("without the option applies from the repository's top, from a subfolder", async () => {
    const root = project();
    write(root, "app/.ork/workflows/a.ork.yaml", "name: a2\n");
    write(root, "app/.ork/workflows/b.ork.yaml", "name: b\n");
    const patch = await changesSince(root, "HEAD");
    sh(root, "reset", "-q", "--hard", "HEAD");
    sh(root, "clean", "-fdq");
    const applied = await applyChanges(path.join(root, "app"), patch);
    expect(applied.ok).toBe(true);
    expect(
      readFileSync(path.join(root, "app/.ork/workflows/b.ork.yaml"), "utf8"),
    ).toBe("name: b\n");
    expect(
      readFileSync(path.join(root, "app/.ork/workflows/a.ork.yaml"), "utf8"),
    ).toBe("name: a2\n");
    expect(existsSync(path.join(root, "app/app"))).toBe(false);
  });

  it("changes nothing and names the file when one does not apply", async () => {
    const dir = attached();
    write(dir, "workflows/a.ork.yaml", "name: edited elsewhere\n");
    const before = contents(dir);
    const applied = await applyChanges(
      dir,
      await writerPatch(project()),
      PLAIN,
    );
    expect(applied).toMatchObject({
      ok: false,
      conflicts: ["workflows/a.ork.yaml"],
    });
    expect(contents(dir)).toEqual(before);
  });

  it("refuses a patch whose path leaves the folder", async () => {
    const parent = folder();
    const dir = path.join(parent, "inside");
    mkdirSync(dir);
    const applied = await applyChanges(
      dir,
      [
        "diff --git a/../escaped.txt b/../escaped.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/../escaped.txt",
        "@@ -0,0 +1 @@",
        "+x",
        "",
      ].join("\n"),
      PLAIN,
    );
    expect(applied.ok).toBe(false);
    expect(existsSync(path.join(parent, "escaped.txt"))).toBe(false);
  });

  it("refuses to write through a link in the folder", async () => {
    const dir = folder();
    const outside = folder();
    symlinkSync(outside, path.join(dir, "workflows"));
    const root = project();
    write(root, "app/.ork/workflows/c.ork.yaml", "name: c\n");
    const applied = await applyChanges(
      dir,
      await changesSince(root, "HEAD", "app/.ork/"),
      PLAIN,
    );
    expect(applied.ok).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });
});
