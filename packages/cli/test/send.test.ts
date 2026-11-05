/**
 * @file The real `ork send`: from a program in a run's tool node it reaches a
 *   session's inbox, and is refused, with its reason, everywhere else. A
 *   stand-in for the session keeps the run alive with no model turn.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  openStore,
  sendFromScript,
  storePath,
  type EventStore,
} from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { liveHandlers, takeLastCommands } from "../src/run/live-handlers.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const SECRET = "marker-secret-value-42";

const ork = (
  place: { home: string; repo: string },
  args: readonly string[],
  env: Record<string, string> = {},
  input?: string | Buffer,
) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: place.repo,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: place.home,
      ORK_NO_UPDATE_CHECK: "1",
      ...env,
    },
  });

/** Records a run as if it were live in this process, with these nodes. */
const liveRun = (store: EventStore, id: string, cwd: string): void => {
  store.begin({ id, workflow: "w", file: "w.ork.yaml", project: cwd });
  store.append(id, {
    type: "run.started",
    runId: id,
    workflow: "w",
    entries: ["check"],
    nodes: [
      { id: "lead", type: "claude.leader" },
      { id: "check", type: "tool.shell", parent: "lead" },
      { id: "alone", type: "tool.shell" },
      { id: "peer", type: "claude.worker" },
    ],
    edges: [],
    channels: [],
  });
};

describe("ork send", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const project = () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-send-")));
    dirs.push(root);
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    mkdirSync(home);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    return { home, repo };
  };

  it("is refused with no run, and tells a session's Bash why", () => {
    const place = project();
    const done = ork(place, ["send", "lead", "-m", "hi"], { ORK_SESSION: "1" });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("`ORK_RUN` and `ORK_NODE` are not set");
  });

  it("takes one way of giving the message", () => {
    const place = project();
    expect(ork(place, ["send", "lead"]).status).toBe(1);
    const both = ork(place, ["send", "lead", "-m", "hi", "--stdin"], {}, "x");
    expect(both.status).toBe(1);
    expect(both.stderr).toContain("one of them");
  });

  it("reaches a node's inbox in a real run, as a script's, with secrets masked", () => {
    const place = project();
    const file = path.join(place.repo, "send.ork.yaml");
    writeFileSync(
      file,
      `schemaVersion: 1
name: send
nodes:
  check:
    type: tool.shell
    command: sh -c '"$ORK_BIN" send gone -m hi 2> refused.txt; echo "failed with $T" | "$ORK_BIN" send later --stdin; echo "sent $?"'
    env: { T: "{{env.ORK_TEST_TOKEN}}" }
  later: { type: claude.worker, prompt: never starts, isolation: readonly }
edges:
  - { from: check, to: later, when: "exitCode == 99" }
messages:
  - between: [check, later]
`,
    );
    const done = ork(place, ["run", file], { ORK_TEST_TOKEN: SECRET });
    expect(done.stderr).toBe("");
    expect(done.status).toBe(0);
    const store = openStore(storePath(place.home));
    const [run] = store.runs();
    const events = store.events(String(run?.id)).map(stored => stored.event);
    store.close();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.received",
        node: "later",
        from: "check",
        via: "script",
        body: "failed with [masked]\n",
      }),
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).toContain("sent 0");
    expect(
      readFileSync(path.join(place.repo, "refused.txt"), "utf8"),
    ).toContain(
      "`gone` is not a contact of `check`, which can write to `later`",
    );
  });

  const refusalOf = async (
    run: string | undefined,
    node: string | undefined,
    to: string,
    prepare?: (store: EventStore) => void,
  ) => {
    const place = project();
    const store = openStore(storePath(place.home));
    try {
      liveRun(store, "r1", place.repo);
      prepare?.(store);
      const sent = await sendFromScript(
        store,
        { run, node, to, body: "hi" },
        place.home,
      );
      return { sent, commands: store.takeCommands("r1") };
    } finally {
      store.close();
    }
  };

  describe("its checks", () => {
    it("lets a tool node write to its owner", async () => {
      const { sent, commands } = await refusalOf("r1", "check", "lead");
      expect(sent).toEqual({ ok: true });
      expect(commands).toEqual([
        { kind: "script", node: "lead", from: "check", body: "hi" },
      ]);
    });

    it.each([
      ["no identity", undefined, undefined, "lead", "are not set"],
      ["a run of one node", "node-1", "check", "lead", "has no message bus"],
      ["an unknown run", "nope", "check", "lead", "There is no run"],
      ["a node that is no tool", "r1", "lead", "peer", "not a tool node"],
      ["someone not a contact", "r1", "check", "peer", "is not a contact"],
      ["no contacts at all", "r1", "alone", "peer", "no one to write to"],
    ])("refuses %s", async (_name, run, node, to, reason) => {
      const { sent, commands } = await refusalOf(run, node, to);
      expect(sent).toMatchObject({ ok: false });
      expect(JSON.stringify(sent)).toContain(reason);
      expect(commands).toEqual([]);
    });

    it("refuses a run that is not running", async () => {
      const { sent } = await refusalOf("r1", "check", "lead", store => {
        store.append("r1", {
          type: "run.finished",
          result: {
            runId: "r1",
            status: "succeeded",
            costUsd: 0,
            nodes: [],
            reasons: [],
            worktrees: [],
          },
        });
      });
      expect(JSON.stringify(sent)).toContain("is not running");
    });

    it("refuses past the cap, and writes nothing more", async () => {
      const { sent, commands } = await refusalOf(
        "r1",
        "check",
        "lead",
        store => {
          for (let message = 1; message <= 100; message += 1) {
            store.scriptCommand(
              "r1",
              { kind: "script", node: "lead", from: "check", body: "x" },
              100,
            );
          }
        },
      );
      expect(JSON.stringify(sent)).toContain("100 messages");
      expect(commands).toHaveLength(100);
    });

    it("reads the latest run.started, as a resume may change channels", async () => {
      const { sent } = await refusalOf("r1", "alone", "peer", store => {
        store.append("r1", {
          type: "run.started",
          runId: "r1",
          workflow: "w",
          entries: ["alone"],
          nodes: [
            { id: "alone", type: "tool.shell" },
            { id: "peer", type: "claude.worker" },
          ],
          edges: [],
          channels: [["alone", "peer"]],
        });
      });
      expect(sent).toEqual({ ok: true });
    });
  });

  const inRun = (args: readonly string[], input?: string | Buffer) => {
    const place = project();
    const store = openStore(storePath(place.home));
    liveRun(store, "r1", place.repo);
    store.close();
    const done = ork(
      place,
      ["send", ...args],
      { ORK_RUN: "r1", ORK_NODE: "check" },
      input,
    );
    const again = openStore(storePath(place.home));
    const commands = again.takeCommands("r1");
    again.close();
    return { done, commands };
  };

  describe("what it takes", () => {
    it.each([
      ["no node", ["-m", "hi"], undefined, "Give one node"],
      ["two nodes", ["lead", "peer", "-m", "hi"], undefined, "Give one node"],
      ["nothing but spaces", ["lead", "--stdin"], " \n\t", "is empty"],
      ["nothing but NUL bytes", ["lead", "--stdin"], "\0\0", "is empty"],
      [
        "bytes that are not text",
        ["lead", "--stdin"],
        Buffer.from([0xff, 0xfe, 0x41]),
        "not UTF-8",
      ],
      [
        "a message over the limit",
        ["lead", "--stdin"],
        "x".repeat(64 * 1024 + 1),
        "over 64 KiB",
      ],
      [
        "an argument over the limit",
        ["lead", "-m", "x".repeat(64 * 1024 + 1)],
        undefined,
        "over 64 KiB",
      ],
    ])("refuses %s, on stderr alone", (_name, args, input, reason) => {
      const { done, commands } = inRun(args, input);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain(reason);
      expect(done.stdout).toBe("");
      expect(commands).toEqual([]);
    });

    it("takes a message at the limit", () => {
      const { done, commands } = inRun(
        ["lead", "--stdin"],
        "x".repeat(64 * 1024),
      );
      expect(done.status).toBe(0);
      expect(commands).toHaveLength(1);
    });

    it("says it may not write before it reads the message", () => {
      const place = project();
      const done = ork(
        place,
        ["send", "lead", "--stdin"],
        {},
        "x".repeat(64 * 1024 + 1),
      );
      expect(done.stderr).toContain("`ORK_RUN` and `ORK_NODE` are not set");
    });
  });

  it("takes every command on its way before the run finishes", async () => {
    const landed: string[] = [];
    const started = Promise.resolve({
      receive: (_node: string, _from: string, body: string) => {
        landed.push(body);
      },
    });
    const { onScript } = liveHandlers(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `receive` is called
      started as unknown as Parameters<typeof liveHandlers>[0],
    );
    await takeLastCommands(
      {
        check: () => {
          onScript("lead", "check", "last word");
        },
      },
      started,
    )();
    expect(landed).toEqual(["last word"]);
  });

  it("masks in its message what its run told it to, and prints nothing", () => {
    const place = project();
    const store = openStore(storePath(place.home));
    liveRun(store, "r1", place.repo);
    store.close();
    const done = ork(place, ["send", "lead", "-m", `saw ${SECRET}`], {
      ORK_RUN: "r1",
      ORK_NODE: "check",
      ORK_MASKED: "ORK_TEST_TOKEN",
      ORK_TEST_TOKEN: SECRET,
    });
    expect(done.stderr).toBe("");
    expect(done.status).toBe(0);
    expect(done.stdout).toBe("");
    const again = openStore(storePath(place.home));
    const commands = again.takeCommands("r1");
    again.close();
    expect(commands).toEqual([
      { kind: "script", node: "lead", from: "check", body: "saw [masked]" },
    ]);
  });
});
