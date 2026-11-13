/**
 * @file Tests `ork ui --no-open` end to end, from source, with a temp `HOME`
 *   (so `ui.json` and the store are the test's own) and `--port 0`: in an
 *   unguarded store it prints the sign-in link; started the way a nested run
 *   starts a program (`ORK_RUN` plus `ORK_GUARDED_STORES` listing the store,
 *   ADR-047) it prints the refusal and no link, since the link acts as the
 *   user. The supervisor and the server it spawns are ended after each test.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { storePath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const LINK =
  /Open it with this link, which signs you in: http:\/\/127\.0\.0\.1:\d+\/\?code=\S+/u;
const REFUSAL = "does not get the sign-in link, which acts as you";

type Ui = { child: ChildProcess; out: () => string; err: () => string };

const running: Ui[] = [];

/** `ork ui --no-open --port 0` in its own process group, with `extra` env. */
const startUi = (home: string, extra: Record<string, string>): Ui => {
  const child = spawn(
    process.execPath,
    [BIN, "ui", "--no-open", "--port", "0"],
    {
      cwd: home,
      // Its own group, so the supervisor and its server end together.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        NO_COLOR: "1",
        ORK_NO_UPDATE_CHECK: "1",
        ...extra,
      },
    },
  );
  let out = "";
  let err = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const ui = { child, out: () => out, err: () => err };
  running.push(ui);
  return ui;
};

const home = () =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-ui-sign-in-")));

/** Signals the group; `false` once it is gone. */
const signal = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(-pid, name);
    return true;
  } catch {
    return false;
  }
};

/** Ends a started `ork ui`: SIGINT, then SIGKILL when it does not leave in time. */
const stopUi = async ({ child }: Ui): Promise<void> => {
  const pid = child.pid;
  if (pid === undefined) return;
  const exited = new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else
      child.once("exit", () => {
        resolve();
      });
  });
  signal(pid, "SIGINT");
  const timer = setTimeout(() => {
    signal(pid, "SIGKILL");
  }, 8000);
  await exited;
  clearTimeout(timer);
  // The server may outlive a supervisor that was killed.
  signal(pid, "SIGKILL");
};

afterEach(async () => {
  await Promise.all(running.splice(0).map(ui => stopUi(ui)));
});

describe("ork ui --no-open", () => {
  it("prints the sign-in link in a store no run guards", async () => {
    const ui = startUi(home(), {});
    await expect.poll(ui.out, { timeout: 30_000 }).toMatch(LINK);
    expect(ui.out()).toMatch(/Ork's UI is at http:\/\/127\.0\.0\.1:\d+/u);
    expect(ui.err()).not.toContain(REFUSAL);
  }, 40_000);

  it("withholds the link, and says why, under a run that guards the store", async () => {
    const place = home();
    const ui = startUi(place, {
      ORK_RUN: "outer-run",
      ORK_GUARDED_STORES: JSON.stringify([storePath(place)]),
    });
    await expect.poll(ui.err, { timeout: 30_000 }).toContain(REFUSAL);
    // The refusal is `show`'s whole answer: no code was minted, no link printed.
    await expect
      .poll(ui.out, { timeout: 30_000 })
      .toMatch(/Ork's UI is at http:\/\/127\.0\.0\.1:\d+/u);
    expect(ui.out() + ui.err()).not.toContain("code=");
    expect(ui.out()).not.toContain("signs you in");
  }, 40_000);
});
