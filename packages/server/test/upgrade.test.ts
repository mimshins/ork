/**
 * @file Tests for the upgrade `ork ui` offers: the plan, asked of a fake
 *   registry and recorded as `ork upgrade` records it; running it only as
 *   planned, one at a time, with its output streamed and kept; and the restart
 *   hook, called only after the answer and never during an upgrade. The
 *   installer and the restart are fakes; nothing is installed or restarted.
 */

import { type InstallOutput, readUpdateCache } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import type { UpgradePlanView } from "../src/index.ts";
import { KEPT_LINES, plainLine, startJob } from "../src/upgrade-job.ts";
import {
  fakeRegistry,
  readSse,
  startTestServer,
  type TestServer,
  text,
} from "./fixtures.ts";

const NAME = "@krapht/ork";
const NPM_SCRIPT = "/usr/local/lib/node_modules/@krapht/ork/dist/bin.mjs";
const CLONE_SCRIPT = "/home/me/ork/packages/cli/dist/bin.mjs";

const ignore = (): void => {};

/** An installer the test finishes, and the commands it was given. */
const fakeInstall = () => {
  const runs: string[][] = [];
  let output: InstallOutput = ignore;
  let finish: (code: number) => void = ignore;
  return {
    runs,
    install: (argv: readonly string[], onOutput: InstallOutput) => {
      runs.push([...argv]);
      output = onOutput;
      return new Promise<number>(resolve => {
        finish = resolve;
      });
    },
    say: (stream: "stdout" | "stderr", words: string) => {
      output(stream, words);
    },
    finish: (code: number) => {
      finish(code);
    },
  };
};

let fixture: TestServer | undefined;
const stops: AbortController[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) stop.abort();
  await fixture?.close();
  fixture = undefined;
});

const serve = async (
  over: {
    latest?: string | null;
    script?: string;
    restart?: () => void;
  } = {},
) => {
  const installer = fakeInstall();
  const registry = fakeRegistry(
    over.latest === undefined ? "10.0.0" : over.latest,
  );
  fixture = await startTestServer({
    update: {
      name: NAME,
      env: { CI: "1" },
      fetch: registry.fetch,
      script: over.script ?? NPM_SCRIPT,
      install: installer.install,
    },
    ...(over.restart === undefined ? {} : { restart: over.restart }),
  });
  return { server: fixture, installer, registry };
};

const planOf = async (server: TestServer): Promise<UpgradePlanView> => {
  const answer = await server.client.call("upgradePlan");
  return answer.ok ? answer.data : { kind: "unreachable" };
};

const planIdOf = (plan: UpgradePlanView): string =>
  "planId" in plan ? plan.planId : "";

const streamOf = async (server: TestServer, after = 0) => {
  const stop = new AbortController();
  stops.push(stop);
  const response = await server.get(`/api/upgrade/stream?after=${after}`);
  return readSse(response, stop.signal);
};

describe("the upgrade's plan", () => {
  it("asks the registry now, gives the installer's command, and records it", async () => {
    const { server, registry } = await serve();
    expect(await planOf(server)).toMatchObject({
      kind: "command",
      current: "9.9.9",
      latest: "10.0.0",
      releaseNotes: text("%40krapht%2Fork%4010.0.0"),
      installer: { id: "npm", label: "npm (global)" },
      command: ["npm", "install", "--global", "@krapht/ork@10.0.0"],
      running: [],
    });
    // Asked on purpose, even with the background check off.
    expect(registry.asked).toHaveLength(1);
    expect(
      readUpdateCache(`${server.home}/.ork/update-check.json`),
    ).toMatchObject({
      latest: "10.0.0",
      notified: { version: "10.0.0" },
    });
  });

  it("says when this is the latest, or the registry can't be reached", async () => {
    const latest = await serve({ latest: "9.9.9" });
    expect(await planOf(latest.server)).toEqual({
      kind: "latest",
      current: "9.9.9",
    });
    await latest.server.close();
    const offline = await serve({ latest: null });
    expect(await planOf(offline.server)).toEqual({ kind: "unreachable" });
  });

  it("gives advice, and no command, for a clone", async () => {
    const { server } = await serve({ script: CLONE_SCRIPT });
    expect(await planOf(server)).toMatchObject({
      kind: "advice",
      installer: { id: "source", label: "a clone of the repository" },
      text: "In /home/me/ork: git pull, then pnpm install and pnpm build.",
      words: "In `/home/me/ork`, run:",
      commands: ["git pull", "pnpm install", "pnpm build"],
    });
  });

  it("isn't offered by a server `ork ui` did not start", async () => {
    fixture = await startTestServer();
    expect(await fixture.client.call("upgradePlan")).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe("running the upgrade", () => {
  it("runs the planned command, streams its output, and keeps how it ended", async () => {
    const { server, installer } = await serve();
    const plan = await planOf(server);
    const started = await server.client.call("upgrade", {
      body: { planId: planIdOf(plan) },
    });
    expect(started).toMatchObject({
      ok: true,
      status: 202,
      data: { job: { state: "running", latest: "10.0.0" } },
    });
    expect(installer.runs).toEqual([
      ["npm", "install", "--global", "@krapht/ork@10.0.0"],
    ]);
    installer.say("stdout", "\u001B[32madded\u001B[0m 1 package\npartial");
    const stream = await streamOf(server);
    installer.say("stderr", "warn: old node\n");
    installer.finish(0);
    await expect.poll(() => stream.seen.map(e => e.event)).toContain("end");
    expect(stream.seen.map(e => e.data)).toEqual([
      { seq: 1, stream: "stdout", text: "added 1 package" },
      { seq: 2, stream: "stderr", text: "warn: old node" },
      { seq: 3, stream: "stdout", text: "partial" },
      { state: "succeeded", code: 0, version: "10.0.0" },
    ]);
    const version = await server.client.call("version");
    expect(version).toMatchObject({
      ok: true,
      data: { job: { state: "succeeded", code: 0 } },
    });
    const again = await streamOf(server, 2);
    await expect
      .poll(() => again.seen.map(e => e.event))
      .toEqual(["output", "end"]);
    expect(again.seen[0]?.id).toBe("3");
  });

  it("runs one at a time, and never while one runs", async () => {
    const { server } = await serve();
    const planId = planIdOf(await planOf(server));
    await server.client.call("upgrade", { body: { planId } });
    expect(await server.client.call("upgrade", { body: { planId } })).toEqual({
      ok: false,
      status: 409,
      error: "An upgrade is already running.",
    });
  });

  it("refuses a plan that changed, and an advice", async () => {
    const { server } = await serve();
    expect(
      await server.client.call("upgrade", { body: { planId: "old" } }),
    ).toEqual({
      ok: false,
      status: 409,
      error:
        "The plan changed since you read it: Ork 10.0.0 is out now. Read it again before upgrading.",
    });
    await server.close();
    const clone = await serve({ script: CLONE_SCRIPT });
    const planId = planIdOf(await planOf(clone.server));
    expect(
      await clone.server.client.call("upgrade", { body: { planId } }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(clone.installer.runs).toEqual([]);
  });

  it("keeps a failure's exit code", async () => {
    const { server, installer } = await serve();
    const planId = planIdOf(await planOf(server));
    await server.client.call("upgrade", { body: { planId } });
    installer.finish(1);
    await expect
      .poll(() => server.client.call("version"))
      .toMatchObject({ data: { job: { state: "failed", code: 1 } } });
  });
});

describe("the restart", () => {
  it("is refused by a server `ork ui` can't restart", async () => {
    const { server } = await serve();
    expect(await server.client.call("restart")).toMatchObject({
      ok: false,
      status: 400,
      error: "This server can't restart itself; stop it and run `ork ui`.",
    });
  });

  it("answers first, then asks `ork ui` to restart it, never mid-upgrade", async () => {
    let restarts = 0;
    const { server } = await serve({
      restart: () => {
        restarts += 1;
      },
    });
    const planId = planIdOf(await planOf(server));
    await server.client.call("upgrade", { body: { planId } });
    expect(await server.client.call("restart")).toMatchObject({
      ok: false,
      status: 409,
    });
    await server.close();
    const idle = await serve({
      restart: () => {
        restarts += 1;
      },
    });
    const answer = await idle.server.client.call("restart");
    expect(answer).toEqual({
      ok: true,
      status: 202,
      data: { port: idle.server.server.port, pid: process.pid },
    });
    await expect.poll(() => restarts).toBe(1);
  });
});

describe("the job's output", () => {
  it("shows a line as a terminal ends up showing it", () => {
    expect(plainLine("\u001B[1;31mERR!\u001B[0m failed  ")).toBe("ERR! failed");
    expect(plainLine("10%\r50%\r100%")).toBe("100%");
    expect(plainLine("\u001B]0;title\u0007done")).toBe("done");
  });

  it(`keeps the last ${String(KEPT_LINES)} lines, and says earlier ones went`, () => {
    let say: InstallOutput = ignore;
    const job = startJob(
      "10.0.0",
      ["npm"],
      (_argv, onOutput) => {
        say = onOutput;
        return new Promise<number>(() => {});
      },
      () => {},
    );
    say("stdout", "line\n".repeat(KEPT_LINES + 5));
    const kept = job.linesAfter(0);
    expect(kept.lines).toHaveLength(KEPT_LINES);
    expect(kept.lines[0]?.seq).toBe(6);
    expect(kept.dropped).toBe(true);
    expect(job.linesAfter(5).dropped).toBe(false);
  });
});
