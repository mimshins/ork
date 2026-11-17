/**
 * @file Tests that an Ork built-in validates in a project attached with `ork
 *   register`: its bundle file lives under
 *   `~/.ork/projects/<id>/runs/.builtin/`, outside the repository, and its
 *   context references are checked there (not as "outside the project"), as
 *   they are in an `ork init` project.
 */

import path from "node:path";

import {
  builtinWorkflowFile,
  openStore,
  type ProjectPlace,
  storePath,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { explainNode } from "../src/commands/context.ts";
import { loadWorkflow } from "../src/commands/validate.ts";
import { registerProject } from "../src/index.ts";
import { clone, registered, tmp } from "./fixtures/run-root-kit.ts";

/** A clone registered as an attached project, with the audit's bundle written. */
const attached = () => {
  const root = clone(false);
  const home = tmp("ork-home-");
  // The home's own store, which `explainNode` reads the projects from.
  const store = openStore(storePath(home));
  const place: ProjectPlace = registered(
    registerProject(store, root, { home }),
  );
  store.close();
  const file = builtinWorkflowFile(place, "ork:security-audit") ?? "";
  return { root, home, place, file };
};

const filesOf = (result: ReturnType<typeof explainNode>): string =>
  result.ok ? result.explanation.files.map(f => f.name).join(" ") : "";

describe("`ork:security-audit` in an attached project", () => {
  it("has its bundle under the project's folder in the user's home", () => {
    const { home, place, file } = attached();
    expect(place.mode).toBe("attached");
    expect(file).toContain(path.join(home, ".ork", "projects"));
  });

  it("validates with no diagnostics", () => {
    const { root, home, place, file } = attached();
    const loaded = loadWorkflow(file, root, home, [place]);
    expect(loaded.report.diagnostics).toEqual([]);
    expect(loaded.workflow).not.toBeNull();
    expect(loaded.refRoot).toBe(place.dir);
  });

  it("lists the context files of a node for `ork context explain`", () => {
    const { root, home, file } = attached();
    const result = explainNode(file, "recon", root, home);
    expect(filesOf(result)).toContain("read-only-bash.md");
  });
});
