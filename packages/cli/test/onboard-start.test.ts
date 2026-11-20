/**
 * @file Tests for what stops `ork onboard` before it spends, and the driver it
 *   takes: each refusal (flags, no terminal, no commit, git or Node),
 *   `--driver` as given or refused, the only ready driver with no question, and
 *   a choice among several.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { type Picked, pickDriver } from "../src/onboard/driver.ts";
import { refusal, type RefusalInput } from "../src/onboard/refusals.ts";
import { readyOnly } from "./fixtures/drivers.ts";

const input = (over: Partial<RefusalInput> = {}): RefusalInput => ({
  cwd: "/nowhere",
  interactive: true,
  review: false,
  fresh: false,
  nodeVersion: "24.20.0",
  exec: () => Promise.resolve({ ok: true, stdout: "git version 2.40" }),
  ...over,
});

describe("refusal", () => {
  it("lets a terminal in a repository with a commit through", async () => {
    expect(await refusal(input())).toBeNull();
  });

  it("refuses --review with --fresh", async () => {
    expect(await refusal(input({ review: true, fresh: true }))).toEqual([
      "--review and --fresh can't be used together.",
    ]);
  });

  it("refuses with no terminal", async () => {
    expect(await refusal(input({ interactive: false }))).toEqual([
      "ork onboard asks questions: run it in a terminal.",
    ]);
  });

  it("stops with headWarning's text when there is no commit", async () => {
    const lines = await refusal(
      input({
        exec: (_program, args) =>
          Promise.resolve({
            ok: !args.includes("--verify"),
            stdout: "git version 2.40",
          }),
      }),
    );
    expect(lines).toEqual([
      "git: no commit yet. Make a first commit: worktree runs branch from HEAD.",
    ]);
  });

  it("stops with the hint when git is missing or Node is too old", async () => {
    const noGit = await refusal(
      input({ exec: () => Promise.resolve({ ok: false, stdout: "" }) }),
    );
    expect(noGit?.[0]).toContain("git: not found");
    expect(noGit?.[0]).toContain("Install git");
    const old = await refusal(input({ nodeVersion: "20.0.0" }));
    expect(old?.[0]).toContain("Ork needs Node");
  });
});

/** The lines a stop prints, none for a driver. */
const linesOf = (picked: Picked): string =>
  picked.kind === "stop" ? picked.lines.join("\n") : "";

const quietIO = {
  input: process.stdin,
  output: process.stderr,
  env: { NO_COLOR: "1" },
  readLine: () => Promise.resolve("2"),
};

describe("pickDriver", () => {
  it("refuses an unknown --driver and one that is not ready", async () => {
    const unknown = await pickDriver(quietIO, "gpt", readyOnly("claude-code"));
    expect(unknown).toMatchObject({ kind: "stop", code: 1 });
    const notReady = await pickDriver(
      quietIO,
      "open-code",
      readyOnly("claude-code"),
    );
    expect(notReady).toMatchObject({ kind: "stop", code: 1 });
  });

  it("takes --driver as given when it is ready", async () => {
    expect(
      await pickDriver(quietIO, "open-code", readyOnly("open-code")),
    ).toEqual({ kind: "driver", driver: "open-code" });
  });

  it("takes the only ready driver without a question", async () => {
    const io = {
      ...quietIO,
      readLine: () => Promise.reject(new Error("asked")),
    };
    expect(await pickDriver(io, undefined, readyOnly("command-code"))).toEqual({
      kind: "driver",
      driver: "command-code",
    });
  });

  it("asks which driver when several are ready, and takes the answer", async () => {
    const card = new PassThrough();
    const asked = await pickDriver(
      { ...quietIO, output: card },
      undefined,
      readyOnly("claude-code", "open-code"),
    );
    const shown = String(card.read());
    expect(shown).toContain("Which driver should both onboarding runs use?");
    expect(shown).toContain("claude-code");
    expect(shown).toContain("open-code");
    // The checks list open-code first, and `quietIO` answers "2".
    expect(asked).toEqual({ kind: "driver", driver: "claude-code" });
  });

  it("stops with the hints when none is ready", async () => {
    const none = await pickDriver(quietIO, undefined, readyOnly());
    expect(none).toMatchObject({ kind: "stop", code: 1 });
    expect(linesOf(none)).toContain("Get the claude-code driver ready.");
  });
});
