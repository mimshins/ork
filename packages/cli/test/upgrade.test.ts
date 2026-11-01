/**
 * @file Tests for the new-version notice and `ork upgrade` (ADR-038): when the
 *   check is off, what an upgrade would do for each kind of install, the doctor
 *   line, the notice, and the real command against a local registry.
 */

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readUpdateCache,
  updateCachePath,
  writeUpdateCache,
} from "@krapht/ork-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ORK_META,
  planUpgrade,
  releaseNotes,
  showUpdateNotice,
  updateCheckOff,
  versionCheck,
} from "../src/index.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const NAME = "@krapht/ork";
const NPM_SCRIPT = "/usr/local/lib/node_modules/@krapht/ork/dist/bin.mjs";
const NOW = new Date("2026-11-02T12:00:00Z");

const tempHome = () => mkdtempSync(path.join(tmpdir(), "ork-upgrade-"));

const plan = (latest: string | null, script = NPM_SCRIPT) =>
  planUpgrade({ name: NAME, current: "0.1.0", latest, script });

/** Runs `ork <args>` from source with its own home and environment. */
const ork = (
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string }> =>
  new Promise(resolve => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, ...env }, encoding: "utf8" },
      (error, stdout) => {
        const code = typeof error?.code === "number" ? error.code : 1;
        resolve({ code: error === null ? 0 : code, stdout });
      },
    );
  });

const portOf = (server: Server): number => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

const off = (env: Record<string, string>, argv: string[] = ["ps"]) =>
  updateCheckOff(env, argv, true);

describe("when the check is off", () => {
  it("is on at a terminal, and off when asked, in CI, or for machines", () => {
    expect(off({})).toBeNull();
    expect(off({ ORK_NO_UPDATE_CHECK: "1" })).toBe("turned off");
    expect(off({ NO_UPDATE_NOTIFIER: "true" })).toBe("turned off");
    expect(off({ ORK_NO_UPDATE_CHECK: "0" })).toBeNull();
    expect(off({ CI: "true" })).toBe("in CI");
    expect(off({ CI: "false" })).toBeNull();
    expect(off({ ORK_DETACHED: "1" })).toBe("no terminal");
    expect(updateCheckOff({}, ["ps"], false)).toBe("no terminal");
    expect(off({}, ["ps", "--json"])).toBe("JSON output");
    expect(off({}, ["upgrade"])).toBe("ork upgrade checks for itself");
  });
});

describe("planning an upgrade", () => {
  it("says so when the registry is out of reach or nothing is newer", () => {
    expect(plan(null)).toEqual({ kind: "unreachable" });
    expect(plan("0.1.0")).toEqual({ kind: "latest" });
    expect(plan("0.0.9")).toEqual({ kind: "latest" });
  });

  it("gives the installer's command for a global install", () => {
    expect(plan("0.2.0")).toMatchObject({
      kind: "command",
      latest: "0.2.0",
      argv: ["npm", "install", "--global", "@krapht/ork@0.2.0"],
    });
  });

  it("gives advice for a clone, npx, or an install it cannot place", () => {
    expect(plan("0.2.0", "/home/me/ork/packages/cli/dist/bin.mjs")).toEqual({
      kind: "advice",
      latest: "0.2.0",
      text: "In /home/me/ork: git pull, then pnpm install and pnpm build.",
    });
    expect(plan("0.2.0", "/opt/ork/bin.mjs")).toMatchObject({
      kind: "advice",
      text: "Ork could not tell how it was installed. With npm: npm install --global @krapht/ork@0.2.0",
    });
  });

  it("links the release notes", () => {
    expect(releaseNotes(NAME, "0.2.0")).toBe(
      "https://github.com/mimshins/ork/releases/tag/%40krapht%2Fork%400.2.0",
    );
  });
});

describe("ork doctor's version line", () => {
  it("warns of a newer version, and otherwise says what it knows", () => {
    const cache = { checkedAt: NOW.toISOString(), latest: "0.2.0" };
    expect(versionCheck("0.1.0", cache, false)).toEqual({
      name: "ork",
      status: "warn",
      detail: "0.1.0; 0.2.0 is out",
      hint: "Run ork upgrade.",
    });
    expect(versionCheck("0.2.0", cache, false).detail).toBe(
      "0.2.0 (the latest as of 2026-11-02)",
    );
    expect(versionCheck("0.2.0", null, false).detail).toBe(
      "0.2.0 (not checked for updates yet)",
    );
    expect(versionCheck("0.2.0", null, true).detail).toBe(
      "0.2.0 (update check off)",
    );
  });
});

describe("the notice", () => {
  it("prints once, and records that the user was told", () => {
    const file = updateCachePath(tempHome());
    writeUpdateCache(file, { checkedAt: NOW.toISOString(), latest: "99.0.0" });
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      showUpdateNotice(file, NOW);
      showUpdateNotice(file, NOW);
    } finally {
      spy.mockRestore();
    }
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(
      `Ork 99.0.0 is out (you have ${ORK_META.version}). Upgrade with: ork upgrade`,
    );
    expect(readUpdateCache(file)?.notified).toEqual({
      version: "99.0.0",
      at: NOW.toISOString(),
    });
  });
});

describe("ork upgrade against a registry", () => {
  let server: Server;
  let registry = "";
  let latest = "99.0.0";

  beforeAll(async () => {
    server = createServer((request, response) => {
      const known = request.url === `/-/package/${NAME}/dist-tags`;
      response.writeHead(known ? 200 : 404, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(known ? { latest } : {}));
    });
    await new Promise<void>(resolve => {
      server.listen(0, "127.0.0.1", resolve);
    });
    registry = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(() => {
    server.close();
  });

  it("--check reports a newer version and remembers it", async () => {
    const home = tempHome();
    latest = "99.0.0";
    const result = await ork(["upgrade", "--check"], {
      HOME: home,
      ORK_UPDATE_REGISTRY: registry,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `Ork 99.0.0 is out (you have ${ORK_META.version}).`,
    );
    expect(result.stdout).toContain("releases/tag/%40krapht%2Fork%4099.0.0");
    expect(readUpdateCache(updateCachePath(home))?.latest).toBe("99.0.0");
  });

  it("says when this is the latest version", async () => {
    latest = ORK_META.version;
    const result = await ork(["upgrade"], {
      HOME: tempHome(),
      ORK_UPDATE_REGISTRY: registry,
    });
    expect(result).toEqual({
      code: 0,
      stdout: `✓ Ork ${ORK_META.version} is the latest version.\n`,
    });
  });

  it("from a clone, gives advice and changes nothing", async () => {
    latest = "99.0.0";
    const result = await ork(["upgrade", "--yes"], {
      HOME: tempHome(),
      ORK_UPDATE_REGISTRY: registry,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "git pull, then pnpm install and pnpm build.",
    );
  });

  it("fails clearly when the registry cannot be reached", async () => {
    const result = await ork(["upgrade"], {
      HOME: tempHome(),
      ORK_UPDATE_REGISTRY: `${registry}/missing`,
    });
    expect(result.code).toBe(1);
  });
});
