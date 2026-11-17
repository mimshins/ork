/**
 * @file Tests for where `extract` may read: paths stay inside the session's
 *   folder (symlinks followed) and out of Ork's private session folder, and the
 *   deny list joins the built-in names, the session's `Read(...)` rules and the
 *   project's Claude Code settings, refusing everything when those can't be
 *   parsed.
 */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { secretRoot } from "../src/secret-file.ts";
import {
  deniedRead,
  readPatterns,
  resolveInside,
} from "../src/tools/contain.ts";

const folder = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-contain-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src", "a.ts"), "a\n");
  return root;
};

const settings = (cwd: string, name: string, content: string): void => {
  mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  writeFileSync(path.join(cwd, ".claude", name), content);
};

describe("resolveInside", () => {
  it("resolves a path inside the folder, relative or absolute", () => {
    const cwd = folder();
    expect(resolveInside(cwd, "src/a.ts").rel).toBe("src/a.ts");
    expect(resolveInside(cwd, path.join(cwd, "src", "a.ts")).rel).toBe(
      "src/a.ts",
    );
    expect(resolveInside(cwd, ".").rel).toBe(".");
    expect(resolveInside(cwd, "src/new.ts").rel).toBe("src/new.ts");
  });

  it("refuses `..`, an absolute path outside, and git's `:` magic", () => {
    const cwd = folder();
    expect(() => resolveInside(cwd, "../x")).toThrow(
      "refused: ../x (outside the folder)",
    );
    expect(() => resolveInside(cwd, "/etc/hosts")).toThrow("outside");
    expect(() => resolveInside(cwd, ":(top)x")).toThrow("refused: :(top)x");
  });

  it("refuses a symlink that leads out of the folder", () => {
    const cwd = folder();
    const outside = mkdtempSync(path.join(tmpdir(), "ork-outside-"));
    writeFileSync(path.join(outside, "secret.txt"), "s\n");
    symlinkSync(outside, path.join(cwd, "out"));
    expect(() => resolveInside(cwd, "out/secret.txt")).toThrow(
      "refused: out/secret.txt (outside the folder)",
    );
  });

  it("gives the real path of a symlink inside the folder, and the asked one", () => {
    const cwd = folder();
    symlinkSync(path.join(cwd, "src"), path.join(cwd, "link"));
    const where = resolveInside(cwd, "link/a.ts");
    expect(where.rel).toBe("src/a.ts");
    expect(where.asked).toBe("link/a.ts");
    expect(where.real).toBe(realpathSync(path.join(cwd, "src", "a.ts")));
  });

  it("refuses Ork's private session folder", () => {
    expect(() =>
      resolveInside(tmpdir(), path.join(secretRoot(), "x", "mcp.json")),
    ).toThrow("Ork's private session folder");
  });
});

describe("readPatterns", () => {
  it("keeps the pattern of each Read rule; bare Read is every file", () => {
    expect(
      readPatterns(["Read(secrets/**)", "Bash(cat:*)", "Read", "Edit(x)"]),
    ).toEqual(["secrets/**", "**"]);
  });
});

describe("deniedRead", () => {
  it("denies the built-in names at any depth", () => {
    const denied = deniedRead(folder());
    const refused = [
      ".env",
      ".env.local",
      "app/.env",
      "certs/server.pem",
      "tls.key",
      "home/id_rsa.pub",
      ".npmrc",
      ".git/config",
      "sub/.git/HEAD",
    ];
    expect(refused.filter(rel => !denied(rel))).toEqual([]);
    expect(
      [".gitignore", "src/a.ts", "keys.ts", ".github/ci.yml"].filter(rel =>
        denied(rel),
      ),
    ).toEqual([]);
  });

  it("denies the session's Read(...) patterns, gitignore-style", () => {
    const cwd = folder();
    const denied = deniedRead(cwd, [
      "secrets",
      "*.log",
      "./config/prod.json",
      `/${path.join(realpathSync(cwd), "abs.txt")}`,
    ]);
    expect(denied("secrets/db.txt")).toBe(true);
    expect(denied("a/b/out.log")).toBe(true);
    expect(denied("config/prod.json")).toBe(true);
    expect(denied("abs.txt")).toBe(true);
    expect(denied("config/dev.json")).toBe(false);
    expect(denied(".")).toBe(false);
  });

  it("denies everything for a bare Read rule", () => {
    const denied = deniedRead(folder(), readPatterns(["Read"]));
    expect(denied("src/a.ts")).toBe(true);
    expect(denied(".hidden/x")).toBe(true);
  });

  it("reads the project's settings.json and settings.local.json", () => {
    const cwd = folder();
    settings(
      cwd,
      "settings.json",
      JSON.stringify({ permissions: { deny: ["Read(private/**)", "Bash"] } }),
    );
    settings(
      cwd,
      "settings.local.json",
      JSON.stringify({ permissions: { deny: ["Read(notes.md)"] } }),
    );
    const denied = deniedRead(cwd);
    expect(denied("private/a.txt")).toBe(true);
    expect(denied("docs/notes.md")).toBe(true);
    expect(denied("src/a.ts")).toBe(false);
  });

  it("refuses every path when a settings file can't be parsed", () => {
    const cwd = folder();
    settings(cwd, "settings.json", "{ not json");
    expect(() => deniedRead(cwd)).toThrow(
      "refused: every path, because .claude/settings.json can't be parsed",
    );
  });

  it("refuses every path when the deny list is not a list of rules", () => {
    const cwd = folder();
    settings(
      cwd,
      "settings.local.json",
      JSON.stringify({ permissions: { deny: "Read(x)" } }),
    );
    expect(() => deniedRead(cwd)).toThrow("not a list of rules");
  });

  it("refuses every path when settings.local.json can't be parsed", () => {
    const cwd = folder();
    settings(cwd, "settings.local.json", "[");
    expect(() => deniedRead(cwd)).toThrow(
      "refused: every path, because .claude/settings.local.json can't be parsed",
    );
  });

  it("matches an absolute rule against the file's absolute path", () => {
    const cwd = folder();
    const denied = deniedRead(cwd, ["//**/secrets/**"]);
    expect(denied("secrets/db.txt")).toBe(true);
    expect(denied("app/secrets/db.txt")).toBe(true);
    expect(denied("src/a.ts")).toBe(false);
  });

  it("denies everything under an absolute rule on a folder above the session's", () => {
    const cwd = folder();
    const denied = deniedRead(cwd, [`/${path.dirname(realpathSync(cwd))}`]);
    expect(denied("src/a.ts")).toBe(true);
  });

  it("denies a path under Ork's private session folder", () => {
    expect(deniedRead(tmpdir())("ork-sessions/1-x/mcp.json")).toBe(true);
  });
});

describe("a name starting with two dots", () => {
  it("stays inside the folder", () => {
    const cwd = folder();
    writeFileSync(path.join(cwd, "..foo"), "x\n");
    expect(resolveInside(cwd, "..foo").rel).toBe("..foo");
  });
});
