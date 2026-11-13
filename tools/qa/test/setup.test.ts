/**
 * @file Tests the QA kit's setup: the layout, the stand-ins and the starter
 *   repo.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isKitRoot, ROOT_MARKER, setupKit } from "../setup.ts";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const noInstall = (): void => undefined;

/** A kit root set up beside a tarball in a fresh folder, with no install. */
const makeRoot = (name = "tester"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-qa-test-"));
  made.push(dir);
  return setupKit(path.join(dir, "ork.tgz"), name, noInstall);
};

const run = (
  root: string,
  file: string,
  args: string[],
): { status: number | null; stdout: string } => {
  const result = spawnSync(path.join(root, "bin", file), args, {
    encoding: "utf8",
    env: { ...process.env, PATH: `${root}/bin:${process.env["PATH"]}` },
  });
  return { status: result.status, stdout: result.stdout };
};

const git = (repo: string, ...args: string[]): string =>
  spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();

describe("setupKit", () => {
  it("builds the root beside the tarball, marked, with its folders", () => {
    const root = makeRoot("alpha");
    expect(path.basename(root)).toMatch(/^alpha-/u);
    expect(isKitRoot(root)).toBe(true);
    expect(existsSync(path.join(root, ROOT_MARKER))).toBe(true);
    expect(statSync(path.join(root, "home")).isDirectory()).toBe(true);
    expect(statSync(path.join(root, "prefix")).isDirectory()).toBe(true);
  });

  it("installs the tarball into the prefix through the installer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ork-qa-test-"));
    made.push(dir);
    const calls: string[][] = [];
    const root = setupKit(path.join(dir, "ork.tgz"), "t", (prefix, tarball) => {
      calls.push([prefix, tarball]);
      mkdirSync(path.join(prefix, "node_modules"));
    });
    expect(calls).toEqual([
      [path.join(root, "prefix"), path.join(dir, "ork.tgz")],
    ]);
  });

  it("refuses a name that is not plain", () => {
    expect(() => setupKit("/tmp/ork.tgz", "../x", noInstall)).toThrow(
      "not a plain name",
    );
  });

  it("puts the fake claude in bin/, and it passes the doctor's probes", () => {
    const root = makeRoot();
    const version = run(root, "claude", ["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/u);
    const auth = run(root, "claude", ["auth", "status", "--json"]);
    expect(auth.status).toBe(0);
    expect(auth.stdout).toContain('"loggedIn":true');
    expect(statSync(path.join(root, "bin", "claude")).mode & 0o111).not.toBe(0);
  });

  it("puts the fake cmd in bin/", () => {
    const root = makeRoot();
    expect(run(root, "cmd", ["--version"])).toEqual({
      status: 0,
      stdout: "1.88.5\n",
    });
  });

  it("makes a gh stand-in that logs its argv and exits 1", () => {
    const root = makeRoot();
    expect(run(root, "gh", ["issue", "list", "--limit", "5"]).status).toBe(1);
    run(root, "gh", ["auth", "status"]);
    expect(readFileSync(path.join(root, "gh.log"), "utf8")).toBe(
      "issue list --limit 5\nauth status\n",
    );
  });

  it("commits the starter repo once, with the kit's identity", () => {
    const repo = path.join(makeRoot(), "repos", "starter");
    expect(git(repo, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(repo, "log", "-1", "--format=%an <%ae>")).toBe(
      "ork-qa <qa@invalid>",
    );
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("writes env.sh with HOME, PATH, the update check off and the paid variables unset", () => {
    const root = makeRoot();
    expect(readFileSync(path.join(root, "env.sh"), "utf8")).toBe(
      [
        `export HOME='${root}/home'`,
        `export PATH='${root}/bin':'${root}/prefix/node_modules/.bin':"$PATH"`,
        "export ORK_NO_UPDATE_CHECK=1",
        "unset ANTHROPIC_API_KEY CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY",
        "",
      ].join("\n"),
    );
  });
});
