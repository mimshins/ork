/**
 * @file Tests for where an "always" permission answer is written (RFC-028):
 *   `alwaysOptions` names the project's own rules file, `.ork/project.yaml` in
 *   the user's checkout or `~/.ork/projects/<id>/project.yaml` for an attached
 *   project, writes the rules there, and tells the run's terminal of a
 *   failure.
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

import { inRepoPlace, type ProjectPlace, projectsHome } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { alwaysOptions } from "../src/run/origin.ts";

const RULE = "Bash(git log *)";

const quiet = (_line: string): void => {
  // These tests do not read the terminal's warnings.
};

const temp = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-always-")));

/** An attached project: its repository, and its files under a temp HOME. */
const attached = (): { place: ProjectPlace; root: string; home: string } => {
  const root = temp();
  const home = temp();
  const place: ProjectPlace = {
    root,
    mode: "attached",
    dir: path.join(projectsHome(home), "app"),
    id: "app",
  };
  return { place, root, home };
};

describe("an always answer's destination", () => {
  it("is .ork/project.yaml in the checkout for an in-repo project", () => {
    const root = temp();
    const options = alwaysOptions(inRepoPlace(root), quiet);
    const file = path.join(root, ".ork", "project.yaml");
    expect(options.rulesFile).toBe(file);
    options.rememberAlways?.([RULE]);
    expect(readFileSync(file, "utf8")).toContain(RULE);
    expect(readFileSync(file, "utf8")).toContain("schemaVersion: 1");
  });

  it("is ~/.ork/projects/<id>/project.yaml for an attached project, never the repository", () => {
    const { place, root, home } = attached();
    const options = alwaysOptions(place, quiet);
    const file = path.join(home, ".ork", "projects", "app", "project.yaml");
    expect(options.rulesFile).toBe(file);
    options.rememberAlways?.([RULE]);
    expect(readFileSync(file, "utf8")).toContain(RULE);
    expect(existsSync(path.join(root, ".ork"))).toBe(false);
  });

  it("appends to an existing file and keeps its comments", () => {
    const root = temp();
    const file = path.join(root, ".ork", "project.yaml");
    mkdirSync(path.dirname(file));
    writeFileSync(
      file,
      '# our rules\nschemaVersion: 1\npermissions:\n  # keep this\n  deny: ["Bash(git push *)"]\n',
    );
    alwaysOptions(inRepoPlace(root), quiet).rememberAlways?.([RULE]);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("# our rules");
    expect(text).toContain("# keep this");
    expect(text).toContain(RULE);
  });

  it("hands the terminal's line on as the warning", () => {
    const lines: string[] = [];
    alwaysOptions(inRepoPlace(temp()), line => {
      lines.push(line);
    }).warn?.("could not write");
    expect(lines).toEqual(["could not write"]);
  });
});
