/**
 * @file Tests for project places (ADR-035): which project a folder belongs to,
 *   where an attached project's files and runs live, how its workflows read the
 *   repository, and the store's registered projects.
 */

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bundleRefsOf,
  checkWorkflowText,
  explainWorkflowText,
  inRepoPlace,
  lessons,
  loadAgents,
  newProjectId,
  openStore,
  placeFiles,
  placeFor,
  type ProjectPlace,
  runDirOf,
  shownPath,
  workflowDirOf,
} from "../src/index.ts";
import { repo, write } from "./fixtures/git.ts";

const attached = (root: string): ProjectPlace => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-home-")));
  const dir = path.join(home, ".ork", "projects", "app");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  return { id: "app", root, mode: "attached", dir };
};

/** An explanation's non-user context files, as name and text; or its error. */
const filesOf = (result: ReturnType<typeof explainWorkflowText>) =>
  result.ok
    ? result.explanation.files
        .filter(f => f.layer !== "user")
        .map(f => [f.name, f.text])
    : result.error;

describe("project places", () => {
  it("find a folder's project: an attached one's folder, its root, or in-repo", () => {
    const root = repo();
    const place = attached(root);
    const other = repo();
    const registered = [place];
    expect(placeFor(path.join(place.dir, "workflows"), registered)).toBe(place);
    expect(placeFor(path.join(root, "src"), registered)).toBe(place);
    expect(placeFor(other, registered)).toEqual(inRepoPlace(other));
    expect(runDirOf(place, "r1")).toBe(path.join(place.dir, "runs", "r1"));
    expect(placeFiles(inRepoPlace(other)).rules).toBe(
      path.join(other, ".ork", "project.yaml"),
    );
  });

  it("read an attached workflow's paths as if it were in .ork/workflows", () => {
    const root = repo();
    const place = attached(root);
    const file = path.join(place.dir, "workflows", "review.ork.yaml");
    expect(workflowDirOf(place, file)).toBe(
      path.join(root, ".ork", "workflows"),
    );
    const elsewhere = path.join(root, "flows", "x.ork.yaml");
    expect(workflowDirOf(place, elsewhere)).toBe(path.join(root, "flows"));
  });

  it("read an attached built-in bundle's references from its own folder, held to the project's folder", () => {
    const place = attached(repo());
    const folder = path.join(place.dir, "runs", ".builtin", "0123456789ab");
    const file = path.join(folder, "audit.ork.yaml");
    expect(bundleRefsOf(place, file)).toEqual({
      workflowDir: folder,
      refRoot: place.dir,
    });
    for (const other of [
      path.join(place.dir, "workflows", "audit.ork.yaml"),
      path.join(place.dir, "runs", ".builtin", "audit.ork.yaml"),
      path.join(folder, "nested", "audit.ork.yaml"),
      path.join(place.root, "audit.ork.yaml"),
    ]) {
      expect(bundleRefsOf(place, other)).toBeUndefined();
    }
    const inRepo = inRepoPlace(place.root);
    expect(
      bundleRefsOf(
        inRepo,
        path.join(inRepo.dir, "runs", ".builtin", "0123456789ab", "a.ork.yaml"),
      ),
    ).toBeUndefined();
  });

  it("read lessons and agents from the attached project's folder", () => {
    const root = repo();
    const place = attached(root);
    write(place.dir, "lessons/review.md", "Run the tests first.\n");
    write(
      place.dir,
      "agents/reviewer.md",
      "---\nname: reviewer\n---\nReview.\n",
    );
    expect(
      lessons("review", root, path.join(place.dir, "lessons")).map(l => l.text),
    ).toEqual(["Run the tests first.\n"]);
    const catalog = loadAgents({
      projectRoot: root,
      orkDir: place.dir,
      home: path.resolve(place.dir, "../../.."),
    });
    expect(
      catalog.agents
        .filter(a => a.source !== "builtin")
        .map(a => [a.name, a.source]),
    ).toEqual([["reviewer", "project"]]);
  });

  it("read `.ork/` context from the attached project's folder, alike in validate and explain", () => {
    const root = repo();
    const place = attached(root);
    const home = path.resolve(place.dir, "../../..");
    write(
      place.dir,
      "project.yaml",
      "schemaVersion: 1\ncontext: [.ork/context/a.md]\n",
    );
    write(place.dir, "context/a.md", "project notes\n");
    write(place.dir, "context/b.md", "workflow notes\n");
    write(root, "docs/r.md", "repo notes\n");
    const file = path.join(place.dir, "workflows", "t.ork.yaml");
    const text = [
      "schemaVersion: 1",
      "name: t",
      "layers:",
      "  context: [../context/b.md, ../../docs/r.md]",
      "nodes:",
      "  ok: { type: agent.worker }",
    ].join("\n");
    const missing = `${text}\n  fix: { type: agent.worker, context: [../context/gone.md] }`;
    const registered = [place];
    const checked = checkWorkflowText(missing, {
      place,
      workflowDir: workflowDirOf(place, file),
      registered,
      home,
    });
    expect(
      checked.diagnostics
        .filter(d => d.severity === "error")
        .map(d => `${d.path.join(".")}: ${d.message}`),
    ).toEqual([
      "nodes.fix.context.0: ../context/gone.md does not exist in ~/.ork/projects/app",
    ]);
    const explained = explainWorkflowText(text, file, "ok", {
      registered,
      home,
      place,
    });
    expect(filesOf(explained)).toEqual([
      [".ork/context/a.md", "project notes\n"],
      [".ork/context/b.md", "workflow notes\n"],
      ["docs/r.md", "repo notes\n"],
    ]);
  });

  it("name new projects after their folder, uniquely, and show paths short", () => {
    expect(newProjectId("/work/My App", [])).toBe("my-app");
    expect(newProjectId("/work/api", ["api", "api-2"])).toBe("api-3");
    expect(shownPath("/r/.ork/x", "/r", "/h")).toBe(".ork/x");
    expect(shownPath("/h/.ork/projects/a", "/r", "/h")).toBe(
      "~/.ork/projects/a",
    );
  });
});

describe("registered projects in the store", () => {
  it("are added, listed by id, and forgotten", () => {
    const store = openStore(":memory:");
    store.addProject({
      id: "b",
      root: "/r/b",
      mode: "in-repo",
      dir: "/r/b/.ork",
    });
    store.addProject({ id: "a", root: "/r/a", mode: "attached", dir: "/h/a" });
    expect(store.projects().map(p => [p.id, p.mode])).toEqual([
      ["a", "attached"],
      ["b", "in-repo"],
    ]);
    expect(() =>
      store.addProject({ id: "c", root: "/r/a", mode: "in-repo", dir: "/x" }),
    ).toThrow(/UNIQUE/u);
    expect(store.forgetProject("a")).toBe(true);
    expect(store.forgetProject("a")).toBe(false);
    expect(store.projects().map(p => p.id)).toEqual(["b"]);
  });
});
