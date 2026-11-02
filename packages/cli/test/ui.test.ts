/**
 * @file End-to-end test of `ork ui` (ADR-039): it serves and prints its sign-in
 *   link, a second `ork ui` finds it, a workflow started through the API runs
 *   detached and waits for its decision, the API's answer finishes it, `ork ps`
 *   sees the run, and Ctrl-C stops the server and removes `ui.json` while runs
 *   are unaffected.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import {
  type CallResult,
  createClient,
  readUiFile,
  uiFilePath,
} from "@krapht/ork-server";
import { afterAll, describe, expect, it } from "vitest";

import { portArg, signInLink } from "../src/index.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

const GATED = [
  "schemaVersion: 1",
  "name: gated",
  "nodes:",
  "  approve:",
  "    type: human.gate",
  "    question: Ship it?",
  "    options: [ship, hold]",
  "    recommended: hold",
  "  ship:",
  "    type: tool.shell",
  '    command: "echo shipped"',
  "edges:",
  "  - from: approve",
  "    to: ship",
  "    when: choice == 'ship'",
  "",
].join("\n");

const temp = (prefix: string) =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/** A home with a registered project that has the gated workflow. */
const setUp = () => {
  const home = temp("ork-ui-home-");
  const root = temp("ork-ui-project-");
  const dir = path.join(root, ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(path.join(dir, "workflows", "gated.ork.yaml"), GATED);
  const store = openStore(storePath(home));
  store.addProject({ id: "e2e", root, mode: "in-repo", dir });
  store.close();
  return { home, root };
};

const { home, root } = setUp();
const env = { ...process.env, HOME: home, ORK_NO_UPDATE_CHECK: "1" };
const children: ChildProcess[] = [];

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
});

/** Runs `ork <args>` to its end. */
const ork = (args: readonly string[]) =>
  new Promise<{ code: number; stdout: string }>(resolve => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env, cwd: root, encoding: "utf8" },
      (error, stdout) => {
        resolve({ code: error === null ? 0 : 1, stdout });
      },
    );
  });

/** The running server's record, and a client signed in with its token. */
const signedIn = () => {
  const record = readUiFile(uiFilePath(home));
  if (record === null) throw new Error("ork ui wrote no ui.json");
  const base = `http://127.0.0.1:${String(record.port)}`;
  return {
    ...record,
    base,
    client: createClient({ base, token: record.token }),
  };
};

const runIdOf = (answer: CallResult<{ runId: string }>): string =>
  answer.ok ? answer.data.runId : "";

const idsOf = (answer: CallResult<{ id: string }[]>): string[] =>
  answer.ok ? answer.data.map(d => d.id) : [];

const liveOf = (answer: CallResult<{ live: string }>): string =>
  answer.ok ? answer.data.live : answer.error;

/** Starts `ork ui` and collects what it prints. */
const startUi = () => {
  const child = spawn(
    process.execPath,
    [BIN, "ui", "--no-open", "--port", "0"],
    { env, cwd: root },
  );
  children.push(child);
  const out: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out.push(chunk);
  });
  const exited = new Promise<number | null>(resolve => {
    child.once("exit", code => {
      resolve(code);
    });
  });
  return { child, printed: () => out.join(""), exited };
};

describe("ork ui", () => {
  it("checks --port", () => {
    expect(portArg()).toBe(4417);
    expect(portArg("0")).toBe(0);
    expect(portArg("70000")).toBeNull();
    expect(portArg("http")).toBeNull();
    expect(signInLink(4417, "t")).toBe("http://127.0.0.1:4417/?token=t");
  });

  it("serves the API, runs a workflow detached through it, and stops on Ctrl-C", async () => {
    const ui = startUi();
    await expect
      .poll(ui.printed, { timeout: 10_000 })
      .toContain("signs you in: ");
    const { port, token, base, client } = signedIn();
    expect(ui.printed()).toContain(`signs you in: ${signInLink(port, token)}`);

    const again = await ork(["ui", "--no-open"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(`already running at ${base}`);

    const started = await client.call("start", {
      body: { project: "e2e", workflow: "gated", inPlace: true },
    });
    expect(started).toMatchObject({ ok: true, status: 202 });
    const runId = runIdOf(started);

    const decisions = async () =>
      idsOf(await client.call("decisions", { query: { run: runId } }));
    await expect.poll(decisions, { timeout: 15_000 }).toHaveLength(1);
    const [decision = ""] = await decisions();
    expect(
      await client.call("answer", {
        params: { id: decision },
        body: { choose: "ship" },
      }),
    ).toMatchObject({ ok: true });

    const live = async () =>
      liveOf(await client.call("run", { params: { id: runId } }));
    await expect.poll(live, { timeout: 15_000 }).toBe("succeeded");
    const ps = await ork(["ps", "--all", "--json"]);
    expect(ps.stdout).toContain(`"id": "${runId}"`);

    ui.child.kill("SIGINT");
    expect(await ui.exited).toBe(0);
    expect(readUiFile(uiFilePath(home))).toBeNull();
  }, 60_000);
});
