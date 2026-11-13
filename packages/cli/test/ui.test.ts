/**
 * @file End-to-end test of `ork ui` (ADR-039, ADR-060): it supervises its
 *   server, which serves while it prints its sign-in link; a second `ork ui`
 *   finds it; a workflow started through the API runs detached and waits for
 *   its decision, the API's answer finishes it, `ork ps` sees the run, and
 *   Ctrl-C stops the server and removes `ui.json` while runs are unaffected.
 *   `ork ui --serve` serves only for the `ork ui` that supervises it.
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

import {
  MINT_FAILED_OLDER,
  mintSignInLink,
  portArg,
  signInLink,
  uiFolders,
} from "../src/index.ts";

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
// Without the run markers: `ork ui` withholds its sign-in link from a run (ADR-047),
// and these tests may themselves run inside one.
const env = {
  ...process.env,
  HOME: home,
  ORK_NO_UPDATE_CHECK: "1",
  ORK_RUN: undefined,
  ORK_SESSION: undefined,
};
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

/** The code in the link `ork ui` printed, or "". */
const codeOf = (printed: string): string =>
  /signs you in: \S+\?code=(\S+)/u.exec(printed)?.[1] ?? "";

/** A fake `fetch` that answers `status` with `body`, noting each request. */
const answeringWith =
  (seen: { url: string; auth: string | null }[]) =>
  (status: number, body: unknown): typeof fetch =>
  (url, init) => {
    seen.push({
      url: new Request(url).url,
      auth: new Headers(init?.headers).get("authorization"),
    });
    return Promise.resolve(Response.json(body, { status }));
  };

const refusing: typeof fetch = () =>
  Promise.reject(new Error("connect ECONNREFUSED"));

describe("ork ui", () => {
  it("checks --port", () => {
    expect(portArg()).toBe(4417);
    expect(portArg("0")).toBe(0);
    expect(portArg("70000")).toBeNull();
    expect(portArg("http")).toBeNull();
    expect(signInLink(4417, "c")).toBe("http://127.0.0.1:4417/?code=c");
  });

  it("gets a code with the token in a header, and says when it can't", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const answering = answeringWith(seen);
    expect(
      await mintSignInLink(
        4417,
        "tok",
        answering(200, { code: "abc", expiresIn: 60 }),
      ),
    ).toEqual({ link: "http://127.0.0.1:4417/?code=abc" });
    expect(seen).toEqual([
      { url: "http://127.0.0.1:4417/api/sign-in", auth: "Bearer tok" },
    ]);
    expect(
      await mintSignInLink(4417, "tok", answering(404, { error: "No." })),
    ).toEqual({ failure: MINT_FAILED_OLDER });
    expect(await mintSignInLink(4417, "tok", refusing)).toEqual({
      failure: MINT_FAILED_OLDER,
    });
    expect(
      await mintSignInLink(4417, "tok", answering(403, { error: "Nope." })),
    ).toEqual({ failure: "Could not get a sign-in code: Nope." });
  });

  it("serves only for `ork ui`, which supervises it", async () => {
    expect(await ork(["ui", "--serve"])).toEqual({ code: 1, stdout: "" });
  });

  it("looks for the built UI beside the bundle, then in the workspace", () => {
    expect(uiFolders().at(-1)).toBe(
      path.resolve(import.meta.dirname, "../../ui/dist"),
    );
  });

  it("serves the API, runs a workflow detached through it, and stops on Ctrl-C", async () => {
    const ui = startUi();
    await expect
      .poll(ui.printed, { timeout: 10_000 })
      .toContain("signs you in: ");
    const { port, token, base, client } = signedIn();
    // A code, never the token: the link is single use and short lived.
    const code = codeOf(ui.printed());
    expect(code).not.toBe("");
    expect(ui.printed()).not.toContain(token);
    const redeemed = await fetch(signInLink(port, code), {
      redirect: "manual",
    });
    expect(redeemed.status).toBe(302);
    expect(redeemed.headers.get("set-cookie")).not.toContain(token);
    expect((await fetch(signInLink(port, code))).status).toBe(401);

    const again = await ork(["ui", "--no-open"]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(`already running at ${base}`);
    // The running server gives this path a code too, and the token stays out.
    expect(again.stdout).toContain("?code=");
    expect(codeOf(again.stdout)).not.toBe("");
    expect(again.stdout).not.toContain(token);

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
    const ps = await ork(["ps", "--project", "all", "--json"]);
    expect(ps.stdout).toContain(`"id": "${runId}"`);

    ui.child.kill("SIGINT");
    expect(await ui.exited).toBe(0);
    expect(readUiFile(uiFilePath(home))).toBeNull();
  }, 60_000);
});
