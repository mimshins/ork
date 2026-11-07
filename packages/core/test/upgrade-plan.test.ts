/**
 * @file Tests for what an upgrade shares between `ork upgrade` and `ork ui`
 *   (ADR-038): the environment's switches, the runs still running, and running
 *   an installer's command with its output handed over. The "installer" is Node
 *   printing a line, never a package manager.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  INSTALL_NOT_STARTED,
  openStore,
  registryOf,
  runInstall,
  runningRunIds,
  storePath,
  updateSwitchOff,
} from "../src/index.ts";

/** Runs `argv`, collecting what it writes, by stream. */
const collect = async (argv: readonly string[]) => {
  const out: string[] = [];
  const code = await runInstall(argv, (stream, text) => {
    out.push(`${stream}:${text}`);
  });
  return { code, out: out.join("") };
};

const NODE_PRINTS = [
  process.execPath,
  "-e",
  "process.stdout.write('added 1 package\\n'); process.stderr.write('warn\\n'); process.exitCode = 3;",
];

describe("the environment's switches", () => {
  it("names the variable that turns the check off, the first set", () => {
    expect(updateSwitchOff({})).toBeNull();
    expect(updateSwitchOff({ ORK_NO_UPDATE_CHECK: "1" })).toBe(
      "ORK_NO_UPDATE_CHECK",
    );
    expect(updateSwitchOff({ NO_UPDATE_NOTIFIER: "yes", CI: "1" })).toBe(
      "NO_UPDATE_NOTIFIER",
    );
    expect(updateSwitchOff({ CI: "true" })).toBe("CI");
    expect(updateSwitchOff({ CI: "false", ORK_NO_UPDATE_CHECK: "0" })).toBe(
      null,
    );
    expect(updateSwitchOff({ NO_UPDATE_NOTIFIER: "" })).toBeNull();
  });

  it("reads the registry to ask instead of npm's", () => {
    expect(registryOf({})).toBeUndefined();
    expect(registryOf({ ORK_UPDATE_REGISTRY: "" })).toBeUndefined();
    expect(registryOf({ ORK_UPDATE_REGISTRY: "https://r.example" })).toBe(
      "https://r.example",
    );
  });
});

describe("the runs still running", () => {
  it("lists a run whose process is alive by its whole id", () => {
    const store = openStore(
      storePath(mkdtempSync(path.join(tmpdir(), "ork-plan-"))),
    );
    expect(runningRunIds(store)).toEqual([]);
    store.begin({
      id: "live-run-1",
      workflow: "w",
      file: "/p/w.ork.yaml",
      project: "/p",
    });
    expect(runningRunIds(store)).toEqual(["live-run-1"]);
    store.close();
  });
});

describe("running an installer's command", () => {
  it("hands its output over by stream, and resolves its exit code", async () => {
    const { code, out } = await collect(NODE_PRINTS);
    expect(code).toBe(3);
    expect(out).toContain("stdout:added 1 package\n");
    expect(out).toContain("stderr:warn\n");
  });

  it("reads an installer's output to its end through its own Ctrl-C", async () => {
    // As a terminal's Ctrl-C reaches a package manager: it tidies up, saying
    // so, then exits; every line it wrote on the way out is still read.
    const { code, out } = await collect([
      process.execPath,
      "-e",
      [
        "process.on('SIGINT', () => {",
        "  process.stdout.write('rolling back\\n');",
        "  setTimeout(() => { process.stdout.write('rolled back\\n'); process.exit(130); }, 50);",
        "});",
        "process.stdout.write('reifying\\n');",
        "setTimeout(() => process.kill(process.pid, 'SIGINT'), 20);",
        "setTimeout(() => {}, 5000);",
      ].join("\n"),
    ]);
    expect(code).toBe(130);
    expect(out.replaceAll("stdout:", "")).toBe(
      "reifying\nrolling back\nrolled back\n",
    );
  });

  it("ends with 127 and says why when the program can't start", async () => {
    const { code, out } = await collect(["ork-test-no-such-program"]);
    expect(code).toBe(INSTALL_NOT_STARTED);
    expect(out).toContain("stderr:Could not run ork-test-no-such-program:");
  });
});
