/**
 * @file Tests for `~/.ork/ui.json`: written for the user only, read back, a
 *   record whose process is gone counts as none, and only its own server
 *   removes it.
 */

import { spawnSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  readUiFile,
  removeUiFile,
  runningServer,
  uiFilePath,
  writeUiFile,
} from "../src/index.ts";
import { temp } from "./fixtures.ts";

/** The pid of a process that has exited. */
const deadPid = (): number => spawnSync(process.execPath, ["-e", ""]).pid ?? 1;

describe("ui.json", () => {
  it("is written for the user only and read back", () => {
    const file = uiFilePath(temp("ork-ui-"));
    const record = {
      port: 4417,
      pid: process.pid,
      token: "t",
      startedAt: "now",
    };
    writeUiFile(file, record);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readUiFile(file)).toEqual(record);
    expect(runningServer(file)).toEqual(record);
  });

  it("counts a broken record, or one whose server is gone, as none", () => {
    const file = uiFilePath(temp("ork-ui-"));
    expect(readUiFile(file)).toBeNull();
    writeUiFile(file, {
      port: 4417,
      pid: deadPid(),
      token: "t",
      startedAt: "now",
    });
    expect(runningServer(file)).toBeNull();
    writeFileSync(file, "{ nope");
    expect(readUiFile(file)).toBeNull();
  });

  it("is removed only by the server it names", () => {
    const file = uiFilePath(temp("ork-ui-"));
    writeUiFile(file, {
      port: 4417,
      pid: process.pid,
      token: "t",
      startedAt: "now",
    });
    removeUiFile(file, process.pid + 1);
    expect(readUiFile(file)).not.toBeNull();
    removeUiFile(file, process.pid);
    expect(readUiFile(file)).toBeNull();
  });
});
