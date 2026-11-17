/**
 * @file Tests for the `extract` step engine against a temporary git repository:
 *   `read` ranges, `search` through `git grep -E`, `git` diff/show/log with a
 *   denied file's section refused, the cuts, and the refusals of a flag-shaped
 *   ref, git's pathspec magic, a blob id and a path out of the folder.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CutStep,
  type ProducerStep,
  runSteps,
  type StepContext,
} from "../src/tools/extract-steps.ts";

const SECRET = "SECRET_TOKEN=do-not-show";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

const write = (cwd: string, rel: string, content: string): void => {
  mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), content);
};

/** A repository with one commit, then `a.ts` and `.env` changed. */
const repo = (): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-extract-"));
  git(cwd, "init", "-q");
  write(cwd, "a.ts", "one\ntwo\nhello three\nfour\nfive\n");
  write(cwd, "sub/b.txt", "hello b\n");
  write(cwd, ".env", `hello\n${SECRET}\n`);
  git(cwd, "add", "-A", "-f");
  git(cwd, "commit", "-q", "-m", "first");
  write(cwd, "a.ts", "one\ntwo\nhello three\nfour\nfive changed\n");
  write(cwd, ".env", `hello\n${SECRET}2\n`);
  return cwd;
};

const run = (
  cwd: string,
  steps: [ProducerStep, ...CutStep[]],
  context: Partial<StepContext> = {},
) => runSteps({ cwd, ...context }, steps);

/** What a run says: its text, or its error. */
const said = async (
  cwd: string,
  steps: [ProducerStep, ...CutStep[]],
  context: Partial<StepContext> = {},
): Promise<string> => {
  const result = await run(cwd, steps, context);
  return result.ok ? result.text : `error: ${result.error}`;
};

describe("read", () => {
  it("returns numbered lines in the range, and the range's size as read", async () => {
    const cwd = repo();
    const result = await run(cwd, [
      { step: "read", path: "a.ts", from: 2, to: 3 },
    ]);
    expect(result).toEqual({
      ok: true,
      text: "2: two\n3: hello three",
      read: "2: two\n3: hello three".length,
    });
  });

  it("refuses a denied file, a binary file, a missing file and a path out", async () => {
    const cwd = repo();
    write(cwd, "bin.dat", "a\0b");
    const outside = mkdtempSync(path.join(tmpdir(), "ork-out-"));
    write(outside, "x.txt", "x\n");
    symlinkSync(path.join(outside, "x.txt"), path.join(cwd, "link.txt"));
    expect(await said(cwd, [{ step: "read", path: ".env" }])).toBe(
      "error: refused: .env",
    );
    expect(await said(cwd, [{ step: "read", path: "bin.dat" }])).toBe(
      "error: refused: bin.dat (a binary file)",
    );
    expect(await said(cwd, [{ step: "read", path: "nope.ts" }])).toBe(
      "error: no such file: nope.ts",
    );
    expect(await said(cwd, [{ step: "read", path: "link.txt" }])).toBe(
      "error: refused: link.txt (outside the folder)",
    );
    expect(await said(cwd, [{ step: "read", path: "sub" }])).toBe(
      "error: not a file: sub",
    );
  });

  it("refuses a file the session's Read rules deny", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [{ step: "read", path: "a.ts" }], {
        denyRead: ["*.ts"],
      }),
    ).toBe("error: refused: a.ts");
  });

  it("refuses every path when the project's settings can't be parsed", async () => {
    const cwd = repo();
    write(cwd, ".claude/settings.json", "{");
    expect(await said(cwd, [{ step: "read", path: "a.ts" }])).toContain(
      "refused: every path",
    );
  });
});

describe("search", () => {
  it("finds lines with git grep -E and drops denied files", async () => {
    const cwd = repo();
    expect(await said(cwd, [{ step: "search", pattern: "^hel+o" }])).toBe(
      "a.ts:3: hello three\nsub/b.txt:1: hello b",
    );
  });

  it("caps the matches and says how many more there were", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [{ step: "search", pattern: "o", maxMatches: 2 }]),
    ).toBe(
      "a.ts:1: one\na.ts:2: two\n[3 more matches: narrow the pattern or path]",
    );
  });

  it("takes a flag-shaped pattern as a pattern", async () => {
    const cwd = repo();
    expect(await said(cwd, [{ step: "search", pattern: "--output=x" }])).toBe(
      "[no matches]",
    );
  });

  it("searches one folder, case-insensitively", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [
        { step: "search", pattern: "HELLO", path: "sub", ignoreCase: true },
      ]),
    ).toBe("sub/b.txt:1: hello b");
  });

  it("refuses a pathspec with git's magic and a denied path", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [{ step: "search", pattern: "x", path: ":(top)x" }]),
    ).toContain("error: refused: :(top)x");
    expect(
      await said(cwd, [{ step: "search", pattern: "x", path: ".git" }]),
    ).toBe("error: refused: .git");
  });

  it("says when the folder is not a git repository", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ork-nogit-"));
    expect(await said(cwd, [{ step: "search", pattern: "x" }])).toBe(
      "error: not a git repository",
    );
  });
});

describe("git", () => {
  it("diffs the working tree, replacing a denied file's section", async () => {
    const cwd = repo();
    const text = await said(cwd, [{ step: "git", op: "diff" }]);
    expect(text).toContain("[refused: .env]");
    expect(text).toContain("diff --git a/a.ts b/a.ts");
    expect(text).toContain("+five changed");
    expect(text).not.toContain("SECRET");
  });

  it("shows a commit, refusing a denied file's section", async () => {
    const cwd = repo();
    git(cwd, "add", "-A", "-f");
    git(cwd, "commit", "-q", "-m", "second");
    const text = await said(cwd, [{ step: "git", op: "show" }]);
    expect(text).toContain("second");
    expect(text).toContain("[refused: .env]");
    expect(text).not.toContain("SECRET");
  });

  it("diffs a range and staged changes for one path", async () => {
    const cwd = repo();
    git(cwd, "add", "a.ts");
    const staged = await said(cwd, [
      { step: "git", op: "diff", staged: true, path: "a.ts" },
    ]);
    expect(staged).toContain("+five changed");
    git(cwd, "commit", "-q", "-m", "second");
    expect(
      await said(cwd, [{ step: "git", op: "diff", base: "HEAD~1..HEAD" }]),
    ).toContain("+five changed");
  });

  it("logs one line per commit, at most n", async () => {
    const cwd = repo();
    git(cwd, "commit", "-q", "-a", "-m", "second");
    const text = await said(cwd, [{ step: "git", op: "log", n: 1 }]);
    expect(text).toMatch(/^[0-9a-f]+ second$/u);
  });

  it("refuses a flag-shaped ref, a rev:path and a blob id", async () => {
    const cwd = repo();
    const blob = git(cwd, "rev-parse", "HEAD:.env").trim();
    expect(
      await said(cwd, [{ step: "git", op: "show", ref: "--output=x" }]),
    ).toBe("error: refused: ref --output=x (not a plain revision)");
    expect(
      await said(cwd, [{ step: "git", op: "show", ref: "HEAD:.env" }]),
    ).toBe("error: refused: ref HEAD:.env (not a plain revision)");
    expect(await said(cwd, [{ step: "git", op: "show", ref: blob }])).toBe(
      `error: not a commit: ${blob}`,
    );
    expect(
      await said(cwd, [{ step: "git", op: "diff", base: `${blob}..${blob}` }]),
    ).toBe(`error: not a commit: ${blob}`);
  });

  it("refuses a path with git's magic and a denied path", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [{ step: "git", op: "diff", path: ":(top)x" }]),
    ).toContain("error: refused: :(top)x");
    expect(await said(cwd, [{ step: "git", op: "diff", path: ".env" }])).toBe(
      "error: refused: .env",
    );
  });
});

describe("cuts", () => {
  it("takes the head and the tail", async () => {
    const cwd = repo();
    expect(
      await said(cwd, [
        { step: "read", path: "a.ts" },
        { step: "head", lines: 4 },
        { step: "tail", lines: 2 },
      ]),
    ).toBe("3: hello three\n4: four");
  });

  it("keeps matching lines with context, marking gaps", async () => {
    const cwd = repo();
    write(cwd, "m.txt", "x1\na\nb\nx2\nc\nd\ne\nX3\n");
    expect(
      await said(cwd, [
        { step: "read", path: "m.txt" },
        { step: "match", text: "x", ignoreCase: true, context: 1 },
      ]),
    ).toBe("1: x1\n2: a\n3: b\n4: x2\n5: c\n--\n7: e\n8: X3");
  });

  it("reports the producer's size as read, not the cut's", async () => {
    const cwd = repo();
    const result = await run(cwd, [
      { step: "read", path: "a.ts" },
      { step: "head", lines: 1 },
    ]);
    const whole = "1: one\n2: two\n3: hello three\n4: four\n5: five changed";
    expect(result).toEqual({ ok: true, text: "1: one", read: whole.length });
  });
});

/** Whether the temporary folder's disk ignores case (macOS's does). */
const caseInsensitive = (): boolean => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-case-"));
  writeFileSync(path.join(dir, "a"), "");
  return existsSync(path.join(dir, "A"));
};

describe("refusals git and the disk can't get around", () => {
  it("keeps refusing with git's colours forced on", async () => {
    const cwd = repo();
    git(cwd, "config", "color.ui", "always");
    const diff = await said(cwd, [{ step: "git", op: "diff" }]);
    expect(diff).toContain("[refused: .env]");
    expect(diff).not.toContain("SECRET");
    expect(await said(cwd, [{ step: "search", pattern: "^hel+o" }])).toBe(
      "a.ts:3: hello three\nsub/b.txt:1: hello b",
    );
  });

  it.runIf(caseInsensitive())(
    "refuses `.ENV` on a disk that ignores case",
    async () => {
      const cwd = repo();
      expect(await said(cwd, [{ step: "read", path: ".ENV" }])).toBe(
        "error: refused: .ENV",
      );
    },
  );

  it("refuses a diff section the session's Read rules deny", async () => {
    const cwd = repo();
    const diff = await said(cwd, [{ step: "git", op: "diff" }], {
      denyRead: ["a.ts"],
    });
    expect(diff).toContain("[refused: a.ts]");
    expect(diff).not.toContain("five changed");
  });

  it("refuses a diff section the project's settings deny", async () => {
    const cwd = repo();
    write(
      cwd,
      ".claude/settings.json",
      JSON.stringify({ permissions: { deny: ["Read(a.ts)"] } }),
    );
    const diff = await said(cwd, [{ step: "git", op: "diff" }]);
    expect(diff).toContain("[refused: a.ts]");
    expect(diff).not.toContain("five changed");
  });

  it("refuses a rename to a denied name", async () => {
    const cwd = repo();
    git(cwd, "mv", "sub/b.txt", "sub/b.key");
    const diff = await said(cwd, [{ step: "git", op: "diff", staged: true }]);
    expect(diff).toContain("[refused: sub/b.key]");
    expect(diff).not.toContain("rename from");
  });

  it("shows the next commit of a range after a refused section", async () => {
    const cwd = repo();
    git(cwd, "commit", "-q", "-m", "second", "--", "a.ts");
    git(cwd, "commit", "-q", "-m", "third", "--", ".env");
    const shown = await said(cwd, [
      { step: "git", op: "show", ref: "HEAD~2..HEAD" },
    ]);
    expect(shown).toContain("    third");
    expect(shown).toContain("[refused: .env]");
    expect(shown).toContain("    second");
    expect(shown).toContain("+five changed");
    expect(shown).not.toContain("SECRET");
  });

  it("cuts git's output at 1 MiB and says so", async () => {
    const cwd = repo();
    const line = `hello ${"x".repeat(60)}\n`;
    write(cwd, "big.txt", line.repeat(20_000));
    expect(await said(cwd, [{ step: "search", pattern: "hello" }])).toContain(
      "[git output cut at 1 MiB]",
    );
  });

  it("refuses to read a file over 8 MiB", async () => {
    const cwd = repo();
    writeFileSync(
      path.join(cwd, "huge.txt"),
      Buffer.alloc(8 * 1024 * 1024 + 1, 97),
    );
    expect(await said(cwd, [{ step: "read", path: "huge.txt" }])).toBe(
      "error: refused: huge.txt is over 8 MiB; search it",
    );
  });
});

describe("files (RFC-025)", () => {
  it("lists tracked and untracked files, not ignored or denied ones", async () => {
    const cwd = repo();
    write(cwd, ".gitignore", "*.log\n");
    write(cwd, "new.ts", "x\n");
    write(cwd, "debug.log", "x\n");
    const listed = await said(cwd, [{ step: "files" }]);
    expect(listed.split("\n").toSorted()).toEqual([
      ".gitignore",
      "a.ts",
      "new.ts",
      "sub/b.txt",
    ]);
  });

  it("keeps the paths a glob matches, and says how many more there were", async () => {
    const cwd = repo();
    write(cwd, "sub/deeper/c.txt", "x\n");
    expect(await said(cwd, [{ step: "files", glob: "**/*.txt" }])).toBe(
      "sub/b.txt\nsub/deeper/c.txt",
    );
    expect(await said(cwd, [{ step: "files", glob: "*.md" }])).toBe(
      "[no files]",
    );
    expect(await said(cwd, [{ step: "files", path: "sub", max: 1 }])).toBe(
      "sub/b.txt\n[1 more files: narrow the glob or path]",
    );
  });
});

describe("the regex and count cuts (RFC-025)", () => {
  it("keeps lines a POSIX extended expression matches, with context", async () => {
    const cwd = repo();
    const read: ProducerStep = { step: "read", path: "a.ts" };
    expect(
      await said(cwd, [
        read,
        { step: "match", text: "^[0-9]+: (two|four)$", regex: true },
      ]),
    ).toBe("2: two\n4: four");
    expect(
      await said(cwd, [
        read,
        {
          step: "match",
          text: "HELLO",
          regex: true,
          ignoreCase: true,
          context: 1,
        },
      ]),
    ).toBe("2: two\n3: hello three\n4: four");
  });

  it("fails a pattern git can't read, and counts lines", async () => {
    const cwd = repo();
    const read: ProducerStep = { step: "read", path: "a.ts" };
    expect(
      await said(cwd, [read, { step: "match", text: "(", regex: true }]),
    ).toMatch(/^error: git failed/u);
    expect(await said(cwd, [read, { step: "count" }])).toBe("5 lines");
  });
});
