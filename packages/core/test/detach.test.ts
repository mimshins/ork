/**
 * @file How long `detachRun` waits for a background `ork` to record its run:
 *   `timeoutMs` of silence, where a fresh touch of the heartbeat file counts as
 *   a sign of life, up to the `maxMs` cap; a child it gives up on is killed.
 *   The child is `fixtures/beat-ork.ts`. Also the heartbeat itself: it beats
 *   until ended, and only a detached child begins one. POSIX only.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  beginDetachedHeartbeat,
  beginHeartbeat,
  type Detached,
  detachRun,
  endHeartbeat,
  type EventStore,
  HEARTBEAT_ENV,
  openStore,
} from "../src/index.ts";

const posix = process.platform !== "win32";

const STUB = path.join(import.meta.dirname, "fixtures/beat-ork.ts");

/** Silence `detachRun` allows; long enough for the stub's own start. */
const QUIET = 1500;

type Stub = {
  /** How long the stub beats (unset: never). */
  beatMs?: number;
  /** When the stub records its run (unset: never). */
  recordMs?: number;
  /** Printed by a stub that exits at once. */
  exit?: string;
  maxMs?: number;
};

type Started = { result: Detached; ms: number; pidFile: string };

const dirs: string[] = [];
const stores: EventStore[] = [];

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const optional = (name: string, value: number | string | undefined) =>
  value === undefined ? {} : { [name]: String(value) };

/** Starts the stub through `detachRun`, in a folder of its own. */
const start = async (stub: Stub): Promise<Started> => {
  const dir = mkdtempSync(path.join(tmpdir(), "ork-detach-"));
  dirs.push(dir);
  const file = path.join(dir, "state.db");
  const store = openStore(file);
  stores.push(store);
  const pidFile = path.join(dir, "pid");
  const began = Date.now();
  const result = await detachRun({
    store,
    runId: "run00001",
    args: ["run", "feature", "--run-id", "run00001"],
    cwd: dir,
    runDir: path.join(dir, "run"),
    script: STUB,
    timeoutMs: QUIET,
    ...(stub.maxMs === undefined ? {} : { maxMs: stub.maxMs }),
    env: {
      ORK_TEST_STORE: file,
      ORK_TEST_PID_FILE: pidFile,
      ...optional("ORK_TEST_BEAT_MS", stub.beatMs),
      ...optional("ORK_TEST_RECORD_MS", stub.recordMs),
      ...optional("ORK_TEST_EXIT", stub.exit),
    },
  });
  return { result, ms: Date.now() - began, pidFile };
};

/** Whether the stub that wrote `pidFile` has gone. */
const goneSoon = async (pidFile: string): Promise<boolean> => {
  const pid = Number(readFileSync(pidFile, "utf8"));
  await vi.waitFor(
    () => {
      expect(isAlive(pid)).toBe(false);
    },
    { timeout: 3000 },
  );
  return true;
};

const killStub = (dir: string): void => {
  try {
    process.kill(
      -Number(readFileSync(path.join(dir, "pid"), "utf8")),
      "SIGKILL",
    );
  } catch {
    // Gone already, or never started.
  }
};

const touched = (file: string): number => statSync(file).mtimeMs;

const NOT_STARTED = { ok: false, error: "the run did not start in time" };

afterAll(() => {
  for (const dir of dirs) killStub(dir);
  for (const store of stores) store.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!posix).concurrent("detachRun's deadline", () => {
  it("kills a child that never beats and never records", async () => {
    const { result, ms, pidFile } = await start({});
    expect(result).toMatchObject(NOT_STARTED);
    expect(ms).toBeGreaterThanOrEqual(QUIET);
    expect(ms).toBeLessThan(QUIET * 3);
    expect(await goneSoon(pidFile)).toBe(true);
  }, 15_000);

  it("waits past timeoutMs for a child that beats", async () => {
    const { result, ms } = await start({ beatMs: 60_000, recordMs: 3500 });
    expect(result).toMatchObject({ ok: true, runId: "run00001" });
    expect(ms).toBeGreaterThan(QUIET);
  }, 15_000);

  it("kills a child that beats but never records, at maxMs", async () => {
    const { result, ms, pidFile } = await start({
      beatMs: 60_000,
      maxMs: 3000,
    });
    expect(result).toMatchObject(NOT_STARTED);
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThan(4000);
    expect(await goneSoon(pidFile)).toBe(true);
  }, 15_000);

  it("kills a child timeoutMs after its last beat", async () => {
    const { result, ms, pidFile } = await start({
      beatMs: 2000,
      maxMs: 20_000,
    });
    expect(result).toMatchObject(NOT_STARTED);
    // The last beat is at least 1.9 s in; the cap is far off.
    expect(ms).toBeGreaterThanOrEqual(1900 + QUIET);
    expect(ms).toBeLessThan(10_000);
    expect(await goneSoon(pidFile)).toBe(true);
  }, 15_000);

  it("returns the output of a child that exits early", async () => {
    const { result } = await start({ exit: "no such workflow" });
    expect(result).toMatchObject({ ok: false, error: "no such workflow" });
  }, 15_000);
});

describe("the heartbeat", () => {
  let dir = "";

  const beatFile = (): string => {
    dir = mkdtempSync(path.join(tmpdir(), "ork-beat-"));
    return path.join(dir, "starting");
  };

  afterEach(() => {
    endHeartbeat();
    rmSync(dir, { recursive: true, force: true });
  });

  it("touches the file at once and again until ended", async () => {
    const file = beatFile();
    beginHeartbeat(file, 20);
    const first = touched(file);
    await sleep(120);
    const later = touched(file);
    expect(later).toBeGreaterThan(first);
    endHeartbeat();
    const last = touched(file);
    await sleep(120);
    expect(touched(file)).toBe(last);
    expect(existsSync(file)).toBe(true);
  });

  it("does nothing without a file", () => {
    vi.stubEnv(HEARTBEAT_ENV, "");
    expect(() => {
      beginHeartbeat();
    }).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("begins in a detached child, and drops the variable", () => {
    const file = beatFile();
    const env: NodeJS.ProcessEnv = {
      ORK_DETACHED: "1",
      [HEARTBEAT_ENV]: file,
    };
    beginDetachedHeartbeat(env);
    expect(existsSync(file)).toBe(true);
    expect(env[HEARTBEAT_ENV]).toBeUndefined();
  });

  it("writes none in a foreground run", () => {
    const file = beatFile();
    beginDetachedHeartbeat({ [HEARTBEAT_ENV]: file });
    expect(existsSync(file)).toBe(false);
  });
});
