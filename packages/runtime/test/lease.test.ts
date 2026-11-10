/**
 * @file Tests for the `lease` MCP wiring (RFC-014) against a fake `cmd`: the
 *   `ork` entry is added for a session and removed after it, the user's other
 *   entries stay as they were, a second session in the same checkout waits for
 *   the first, a stale lease left by a crash is cleaned on the next session and
 *   by the sweep `ork doctor` runs, a corrupt record counts as stale, and the
 *   bearer token never reaches an error. Through the session runner, the wait
 *   is a `session.waiting` event.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { HumanChannel, RuntimeEvent, SessionSpec } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  claudeCodeAdapter,
  cleanStaleLeases,
  createSessionRuntime,
  type LeaseOptions,
  leaseLedger,
  leaseWiring,
  type WireHooks,
} from "../src/index.ts";

const FAKE = fileURLToPath(
  new URL("fixtures/fake-command.mjs", import.meta.url),
);
const FAKE_CLAUDE = fileURLToPath(
  new URL("fixtures/fake-claude.mjs", import.meta.url),
);
const NO_HUMAN: HumanChannel = {
  ask: () => Promise.resolve("none"),
  permit: () => Promise.resolve({ allow: false, message: "none" }),
};
const TOKEN = "f".repeat(48);
const ENDPOINT = { url: "http://127.0.0.1:9/mcp", token: TOKEN };

const LocalSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.looseObject({
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

const tmp = (name: string): string =>
  mkdtempSync(path.join(tmpdir(), `ork-lease-${name}-`));

type Setup = { options: LeaseOptions; home: string };

const setup = (extra: Record<string, string> = {}): Setup => {
  const home = tmp("home");
  return {
    home,
    options: {
      bin: FAKE,
      ledger: leaseLedger(tmp("runs")),
      env: { ...process.env, HOME: home, ...extra },
      pollMs: 20,
    },
  };
};

const specIn = (cwd: string): SessionSpec => ({
  nodeId: "worker",
  cwd,
  prompt: "Do the task",
  systemAppend: "",
  settingSources: [],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
});

const hooks = (
  reasons: string[] = [],
  signal = new AbortController().signal,
): WireHooks => ({
  waiting: reason => {
    reasons.push(reason);
  },
  signal,
});

/** The file of `folder`'s local scope, as the fake `cmd` keeps it. */
const localFile = ({ home }: Setup, folder: string): string => {
  const slug = realpathSync(folder)
    .replaceAll(/[^a-zA-Z0-9]/gu, "-")
    .replace(/^-+/u, "");
  return path.join(home, ".commandcode", "projects", slug, "mcp.json");
};

const entriesIn = (file: string): z.infer<typeof LocalSchema>["mcpServers"] =>
  LocalSchema.parse(JSON.parse(readFileSync(file, "utf8"))).mcpServers;

/** The entries of `folder`'s local scope. */
const local = (at: Setup, folder: string) => entriesIn(localFile(at, folder));

const cmd = ({ options }: Setup, folder: string, ...args: string[]): void => {
  execFileSync(FAKE, args, { cwd: folder, env: { ...options.env } });
};

const records = ({ options }: Setup): string[] =>
  existsSync(options.ledger) ? readdirSync(options.ledger) : [];

/** Makes every lease record look like its session crashed. */
const crash = ({ options }: Setup): void => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid ?? 0;
  for (const name of readdirSync(options.ledger)) {
    const file = path.join(options.ledger, name);
    const lease = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, JSON.stringify({ ...lease, pid: dead }));
  }
};

const drain = async (
  events: AsyncIterator<RuntimeEvent>,
): Promise<RuntimeEvent[]> => {
  const seen: RuntimeEvent[] = [];
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- events come in order
    const next = await events.next();
    if (next.done === true) return seen;
    seen.push(next.value);
  }
};

const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  const end = () => {
    done = true;
  };
  void promise.then(end, end);
  await delay(100);
  return done;
};

describe("the lease MCP wiring", () => {
  it("adds the ork entry for a session and removes only it after", async () => {
    const at = setup();
    const folder = tmp("checkout");
    cmd(at, folder, "mcp", "add", "--scope", "local", "other", "http://x/1");
    const wired = await leaseWiring(at.options).wire(
      specIn(folder),
      ENDPOINT,
      hooks(),
    );
    expect(local(at, folder)["ork"]).toEqual(
      expect.objectContaining({
        url: ENDPOINT.url,
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(records(at)).toHaveLength(1);
    await wired.release();
    expect(local(at, folder)).toEqual({
      other: { transport: "http", enabled: true, url: "http://x/1" },
    });
    expect(records(at)).toEqual([]);
  });

  it("makes a second session in the same checkout wait for the first", async () => {
    const at = setup();
    const folder = tmp("checkout");
    const wiring = leaseWiring(at.options);
    const first = await wiring.wire(specIn(folder), ENDPOINT, hooks());
    const reasons: string[] = [];
    const second = wiring.wire(specIn(folder), ENDPOINT, hooks(reasons));
    expect(await settled(second)).toBe(false);
    expect(reasons).toEqual([
      `waiting for ${realpathSync(folder)}: Command Code runs one session per checkout`,
    ]);
    await first.release();
    const wired = await second;
    expect(local(at, folder)["ork"]?.url).toBe(ENDPOINT.url);
    await wired.release();
    expect(local(at, folder)).toEqual({});
  });

  it("says in an event that a session waits for its checkout", async () => {
    const at = setup();
    const folder = tmp("checkout");
    const first = await leaseWiring(at.options).wire(
      specIn(folder),
      ENDPOINT,
      hooks(),
    );
    const events = createSessionRuntime(
      { ...claudeCodeAdapter, mcp: leaseWiring(at.options) },
      {
        bin: FAKE_CLAUDE,
        env: { ...at.options.env, FAKE_CLAUDE_NO_ASK: "1" },
      },
    )
      .start(specIn(folder), { human: NO_HUMAN })
      .events[Symbol.asyncIterator]();
    expect((await events.next()).value).toEqual({
      type: "session.waiting",
      reason: `waiting for ${realpathSync(folder)}: Command Code runs one session per checkout`,
    });
    await first.release();
    const rest = await drain(events);
    expect(rest.at(-1)).toEqual(
      expect.objectContaining({ type: "session.finished" }),
    );
    expect(local(at, folder)).toEqual({});
  });

  it("lets sessions in different checkouts run at once", async () => {
    const at = setup();
    const wiring = leaseWiring(at.options);
    const reasons: string[] = [];
    const first = await wiring.wire(specIn(tmp("a")), ENDPOINT, hooks());
    const second = await wiring.wire(
      specIn(tmp("b")),
      ENDPOINT,
      hooks(reasons),
    );
    expect(reasons).toEqual([]);
    await Promise.all([first.release(), second.release()]);
  });

  it("gives up a wait when the session is interrupted", async () => {
    const at = setup();
    const folder = tmp("checkout");
    const wiring = leaseWiring(at.options);
    const first = await wiring.wire(specIn(folder), ENDPOINT, hooks());
    const stop = new AbortController();
    const second = wiring.wire(
      specIn(folder),
      ENDPOINT,
      hooks([], stop.signal),
    );
    stop.abort();
    await expect(second).rejects.toThrow(/abort/iu);
    await first.release();
  });

  it("cleans a crashed session's stale lease when the next session starts", async () => {
    const at = setup();
    const crashed = tmp("crashed");
    cmd(at, crashed, "mcp", "add", "--scope", "local", "other", "http://x/1");
    await leaseWiring(at.options).wire(specIn(crashed), ENDPOINT, hooks());
    crash(at);
    const next = await leaseWiring(at.options).wire(
      specIn(tmp("next")),
      ENDPOINT,
      hooks(),
    );
    expect(Object.keys(local(at, crashed))).toEqual(["other"]);
    expect(records(at)).toHaveLength(1);
    await next.release();
  });

  it("takes over a checkout whose holder crashed, without waiting", async () => {
    const at = setup();
    const folder = tmp("checkout");
    await leaseWiring(at.options).wire(specIn(folder), ENDPOINT, hooks());
    crash(at);
    const reasons: string[] = [];
    const wired = await leaseWiring(at.options).wire(
      specIn(folder),
      ENDPOINT,
      hooks(reasons),
    );
    expect(reasons).toEqual([]);
    await wired.release();
    expect(local(at, folder)).toEqual({});
  });

  it("cleans stale leases for ork doctor, also of a checkout since removed", async () => {
    const at = setup();
    const kept = tmp("kept");
    const gone = tmp("gone");
    cmd(at, gone, "mcp", "add", "--scope", "local", "other", "http://x/1");
    const goneFile = localFile(at, gone);
    const wiring = leaseWiring(at.options);
    await wiring.wire(specIn(kept), ENDPOINT, hooks());
    await wiring.wire(specIn(gone), ENDPOINT, hooks());
    crash(at);
    rmSync(gone, { recursive: true });
    const sweep = await cleanStaleLeases(at.options);
    expect(sweep.cleaned.toSorted()).toEqual(
      [
        realpathSync(kept),
        path.join(path.dirname(realpathSync(kept)), path.basename(gone)),
      ].toSorted(),
    );
    expect(sweep.failed).toEqual([]);
    expect(local(at, kept)).toEqual({});
    expect(records(at)).toEqual([]);
    expect(Object.keys(entriesIn(goneFile))).toEqual(["other"]);
  });

  it("takes a checkout whose record is corrupt, without waiting", async () => {
    const at = setup();
    const folder = tmp("checkout");
    const slug = realpathSync(folder)
      .replaceAll(/[^a-zA-Z0-9]/gu, "-")
      .replace(/^-+/u, "");
    mkdirSync(at.options.ledger, { recursive: true });
    writeFileSync(path.join(at.options.ledger, `${slug}.json`), '{"id": "x"');
    const reasons: string[] = [];
    const wired = await leaseWiring(at.options).wire(
      specIn(folder),
      ENDPOINT,
      hooks(reasons),
    );
    expect(reasons).toEqual([]);
    expect(local(at, folder)["ork"]?.url).toBe(ENDPOINT.url);
    await wired.release();
    expect(records(at)).toEqual([]);
  });

  it("drops a corrupt record when sweeping", async () => {
    const at = setup();
    mkdirSync(at.options.ledger, { recursive: true });
    writeFileSync(path.join(at.options.ledger, "elsewhere.json"), "{");
    await cleanStaleLeases(at.options);
    expect(records(at)).toEqual([]);
  });

  it("leaves a live session's lease alone when sweeping", async () => {
    const at = setup();
    const folder = tmp("checkout");
    const wired = await leaseWiring(at.options).wire(
      specIn(folder),
      ENDPOINT,
      hooks(),
    );
    expect(await cleanStaleLeases(at.options)).toEqual({
      cleaned: [],
      failed: [],
    });
    expect(local(at, folder)["ork"]).toBeDefined();
    await wired.release();
  });

  it("refuses to replace an ork entry the user made", async () => {
    const at = setup();
    const folder = tmp("checkout");
    cmd(at, folder, "mcp", "add", "--scope", "local", "ork", "http://mine");
    await expect(
      leaseWiring(at.options).wire(specIn(folder), ENDPOINT, hooks()),
    ).rejects.toThrow(/already has an `ork` MCP entry/u);
    expect(local(at, folder)["ork"]?.url).toBe("http://mine");
    expect(records(at)).toEqual([]);
  });

  it("never puts the bearer token in an error", async () => {
    const at = setup({ FAKE_CMD_FAIL_ADD: "1" });
    const failure = leaseWiring(at.options).wire(
      specIn(tmp("checkout")),
      ENDPOINT,
      hooks(),
    );
    await expect(failure).rejects.toThrow(/cmd mcp add failed/u);
    await expect(failure).rejects.not.toThrow(TOKEN);
    expect(records(at)).toEqual([]);
  });
});
