/**
 * @file Tests that pin the fail-closed limits of the `extract` step engine: the
 *   1 MiB cap on git's output, the 8 MiB refusal of `read`, and the 10 s git
 *   timeout (a `git` shim on `PATH` that sleeps).
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runSteps } from "../src/tools/extract-steps.ts";

const MIB = 1024 * 1024;

/** A repository with one commit holding `name` with `content`. */
const repoWith = (name: string, content: string | Buffer): string => {
  const cwd = mkdtempSync(path.join(tmpdir(), "ork-limits-"));
  writeFileSync(path.join(cwd, name), content);
  const git = (...args: string[]): void => {
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
      { cwd, stdio: "ignore" },
    );
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  return cwd;
};

/** What a step says: its text, or its error. */
const said = async (
  cwd: string,
  step: Parameters<typeof runSteps>[1][0],
): Promise<string> => {
  const result = await runSteps({ cwd }, [step]);
  return result.ok ? result.text : `error: ${result.error}`;
};

/** Puts a `git` that sleeps first on `PATH` until the test ends. */
const shimSleepingGit = (): void => {
  const bin = mkdtempSync(path.join(tmpdir(), "ork-shim-"));
  const shim = path.join(bin, "git");
  // `exec` so the timeout's kill reaches `sleep` itself.
  writeFileSync(shim, "#!/bin/sh\nexec sleep 60\n");
  chmodSync(shim, 0o755);
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extract limits", () => {
  it("ends a search with over 1 MiB of git output with the cut note", async () => {
    const cwd = repoWith("big.txt", `hello ${"x".repeat(60)}\n`.repeat(40_000));
    const text = await said(cwd, { step: "search", pattern: "hello" });
    expect(text.endsWith("[git output cut at 1 MiB]")).toBe(true);
  });

  it("refuses a file of 8 MiB + 1 byte and names the path", async () => {
    const cwd = repoWith("huge.txt", Buffer.alloc(8 * MIB + 1, 97));
    expect(await said(cwd, { step: "read", path: "huge.txt" })).toBe(
      "error: refused: huge.txt is over 8 MiB; search it",
    );
  });

  it("reads a file of exactly 8 MiB", async () => {
    const cwd = repoWith("edge.txt", Buffer.alloc(8 * MIB, 97));
    const result = await runSteps({ cwd }, [
      { step: "read", path: "edge.txt" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("fails a git call that outlasts 10 s", async () => {
    const cwd = repoWith("a.txt", "hello\n");
    shimSleepingGit();
    expect(await said(cwd, { step: "search", pattern: "hello" })).toBe(
      "error: git timed out after 10 s",
    );
  }, 30_000);
});
