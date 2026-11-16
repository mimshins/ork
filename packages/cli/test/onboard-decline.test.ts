/**
 * @file Tests for `ork onboard`'s free half in a real repository: with no
 *   `.ork/` it runs `ork init`'s file steps, prints the survey, the mode and
 *   the most the paid part can spend, and on a "no" ends with exit 0, no run in
 *   the store and no workflow written. With no ready driver it stops before any
 *   question.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { runOnboard } from "../src/onboard/flow.ts";
import type { OnboardOptions } from "../src/onboard/options.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const repository = (): string => {
  const dir = path.join(
    realpathSync(mkdtempSync(path.join(tmpdir(), "ork-onboard-"))),
    "app",
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), "# App\n");
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "dev@example.com"],
    ["config", "user.name", "Dev"],
    ["add", "-A"],
    ["commit", "-q", "-m", "init"],
  ]) {
    execFileSync("git", args, { cwd: dir });
  }
  return dir;
};

type Seen = { out: string[]; err: string[]; asked: string[] };

/** The command's options, answering each prompt in turn from `answers`. */
const setup = (
  cwd: string,
  answers: string[],
  seen: Seen,
  ready = readyOnly("claude-code"),
): OnboardOptions => {
  const queue = [...answers];
  return {
    cwd,
    store: openStore(":memory:"),
    io: {
      input: process.stdin,
      output: process.stderr,
      env: { NO_COLOR: "1" },
      readLine: prompt => {
        seen.asked.push(prompt);
        return Promise.resolve(queue.shift());
      },
    },
    interactive: true,
    exec: () => Promise.resolve({ ok: true, stdout: "git version 2.40" }),
    nodeVersion: "24.20.0",
    review: false,
    fresh: false,
    checks: ready,
    runtime: () => Promise.reject(new Error("no session may start")),
    out: line => {
      seen.out.push(line);
    },
    err: line => {
      seen.err.push(line);
    },
  };
};

describe("ork onboard, before the paid part", () => {
  it("sets up .ork/, shows the survey, mode and cap, and a no writes nothing", async () => {
    const cwd = repository();
    const seen: Seen = { out: [], err: [], asked: [] };
    const options = setup(cwd, ["slow tests", "weekly", "a PR", "n"], seen);
    expect(await runOnboard(options)).toBe(0);
    const text = seen.out.join("\n");
    expect(text).toContain(".ork/workflows/hello.ork.yaml");
    expect(text).toContain("Mode: first visit");
    expect(text).toContain("The most this can spend: $");
    expect(text).toContain("Nothing started, nothing written.");
    expect(seen.asked).toHaveLength(4);
    expect(options.store.runs()).toEqual([]);
    expect(readdirSync(path.join(cwd, ".ork", "workflows"))).toEqual([
      "hello.ork.yaml",
    ]);
  });

  it("sets up at the repository's root when run from a subfolder", async () => {
    const root = repository();
    const sub = path.join(root, "packages", "web");
    mkdirSync(sub, { recursive: true });
    const seen: Seen = { out: [], err: [], asked: [] };
    const options = setup(sub, ["a", "b", "c", "n"], seen);
    expect(await runOnboard(options)).toBe(0);
    expect(
      existsSync(path.join(root, ".ork", "workflows", "hello.ork.yaml")),
    ).toBe(true);
    expect(existsSync(path.join(root, ".gitignore"))).toBe(true);
    expect(readdirSync(sub)).toEqual([]);
  });

  it("changes nothing in an existing .ork/ before the picks", async () => {
    const cwd = repository();
    mkdirSync(path.join(cwd, ".ork", "workflows"), { recursive: true });
    const seen: Seen = { out: [], err: [], asked: [] };
    const options = setup(cwd, ["a", "b", "c", ""], seen);
    expect(await runOnboard(options)).toBe(0);
    expect(readdirSync(path.join(cwd, ".ork", "workflows"))).toEqual([]);
    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(false);
    expect(seen.out.join("\n")).not.toContain("created");
  });

  it("stops with the login hints, asking nothing, when no driver is ready", async () => {
    const cwd = repository();
    const seen: Seen = { out: [], err: [], asked: [] };
    const options = setup(cwd, [], seen, readyOnly());
    expect(await runOnboard(options)).toBe(1);
    expect(seen.err.join("\n")).toContain("Get the claude-code driver ready.");
    expect(seen.asked).toEqual([]);
    expect(options.store.runs()).toEqual([]);
  });

  it("refuses --review with --fresh before touching the project", async () => {
    const cwd = repository();
    const seen: Seen = { out: [], err: [], asked: [] };
    const options = { ...setup(cwd, [], seen), review: true, fresh: true };
    expect(await runOnboard(options)).toBe(1);
    expect(existsSync(path.join(cwd, ".ork"))).toBe(false);
    expect(seen.err).toEqual(["--review and --fresh can't be used together."]);
  });
});
