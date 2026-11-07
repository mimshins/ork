/**
 * @file Tests for the update check (ADR-038): version precedence, the cache,
 *   when to ask the registry and when to tell the user, and how an install is
 *   recognised.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkDue,
  detectInstaller,
  fetchLatest,
  isNewer,
  pendingNotice,
  readUpdateCache,
  refreshUpdateCache,
  registryShown,
  updateCachePath,
  writeUpdateCache,
} from "../src/index.ts";

const NOW = new Date("2026-11-02T12:00:00Z");
const HOURS = (n: number) =>
  new Date(NOW.getTime() - n * 3_600_000).toISOString();

const tempCache = () =>
  updateCachePath(mkdtempSync(path.join(tmpdir(), "ork-update-")));

/** A fetch that answers with `body` (or fails with `status`), and counts. */
const fakeFetch = (body: unknown, status = 200) => {
  const urls: string[] = [];
  const fetch = (input: string | URL | Request): Promise<Response> => {
    urls.push(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(Response.json(body, { status }));
  };
  return { fetch, urls };
};

const failingFetch = (): Promise<Response> =>
  Promise.reject(new Error("offline"));

const installerOf = (script: string) => detectInstaller(script)?.id;

describe("version precedence", () => {
  it.each([
    ["0.2.0", "0.1.0", true],
    ["0.1.1", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.10.0", "0.9.0", true],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.2.0", false],
    ["0.2.0", "0.2.0-beta.1", true],
    ["0.2.0-beta.2", "0.2.0-beta.1", true],
    ["0.2.0-beta.10", "0.2.0-beta.9", true],
    ["0.2.0-beta", "0.2.0-alpha", true],
    ["0.2.0-beta.1", "0.2.0", false],
    ["v0.2.0", "0.1.0", true],
    ["0.2.0+build.5", "0.2.0", false],
    ["latest", "0.1.0", false],
    ["0.2.0", "not a version", false],
  ])("%s newer than %s: %s", (candidate, current, newer) => {
    expect(isNewer(candidate, current)).toBe(newer);
  });
});

describe("the cache", () => {
  it("round-trips, and reads a missing or broken file as none", () => {
    const file = tempCache();
    expect(readUpdateCache(file)).toBeNull();
    const cache = {
      checkedAt: HOURS(1),
      latest: "0.2.0",
      notified: { version: "0.2.0", at: HOURS(2) },
    };
    writeUpdateCache(file, cache);
    expect(readUpdateCache(file)).toEqual(cache);
    writeFileSync(file, "{ not json");
    expect(readUpdateCache(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ latest: "0.2.0" }));
    expect(readUpdateCache(file)).toBeNull();
  });

  it("is due with no cache, or a day after the last attempt", () => {
    expect(checkDue(null, NOW)).toBe(true);
    expect(checkDue({ checkedAt: HOURS(23) }, NOW)).toBe(false);
    expect(checkDue({ checkedAt: HOURS(25) }, NOW)).toBe(true);
    expect(checkDue({ checkedAt: "garbage" }, NOW)).toBe(true);
  });
});

describe("asking the registry", () => {
  it("reads the latest dist-tag of the package", async () => {
    const { fetch, urls } = fakeFetch({ latest: "0.3.0", next: "0.4.0-rc.1" });
    await expect(
      fetchLatest("@krapht/ork", { fetch, registry: "https://mirror.test/" }),
    ).resolves.toBe("0.3.0");
    expect(urls).toEqual([
      "https://mirror.test/-/package/@krapht/ork/dist-tags",
    ]);
  });

  it("gives null for an error, a strange answer, or no network", async () => {
    await expect(
      fetchLatest("x", { fetch: fakeFetch({}, 404).fetch }),
    ).resolves.toBeNull();
    await expect(
      fetchLatest("x", { fetch: fakeFetch(["0.2.0"]).fetch }),
    ).resolves.toBeNull();
    await expect(fetchLatest("x", { fetch: failingFetch })).resolves.toBeNull();
  });

  it("records each attempt, and keeps the last known version when offline", async () => {
    const file = tempCache();
    await refreshUpdateCache(file, "x", NOW, {
      fetch: fakeFetch({ latest: "0.2.0" }).fetch,
    });
    expect(readUpdateCache(file)).toEqual({
      checkedAt: NOW.toISOString(),
      latest: "0.2.0",
    });
    const later = new Date(NOW.getTime() + 90_000_000);
    await refreshUpdateCache(file, "x", later, { fetch: failingFetch });
    expect(readUpdateCache(file)).toEqual({
      checkedAt: later.toISOString(),
      latest: "0.2.0",
    });
  });

  it("shows a registry without the user name and password it carries", () => {
    expect(registryShown("https://mirror.test/npm")).toBe(
      "https://mirror.test/npm",
    );
    expect(registryShown("https://jo:s3cret@mirror.test/npm")).toBe(
      "https://mirror.test/npm",
    );
    expect(registryShown("https://jo@mirror.test")).toBe(
      "https://mirror.test/",
    );
    expect(registryShown("jo:s3cret@mirror.test/npm")).toBe("mirror.test");
    expect(registryShown("ftp://jo:s3cret@mirror.test/npm")).toBe(
      "mirror.test",
    );
  });
});

describe("the notice", () => {
  it("tells of a newer version once a day, and again for a newer one", () => {
    const cache = { checkedAt: HOURS(1), latest: "0.2.0" };
    expect(pendingNotice(null, "0.1.0", NOW)).toBeNull();
    expect(pendingNotice(cache, "0.2.0", NOW)).toBeNull();
    expect(pendingNotice(cache, "0.1.0", NOW)).toBe("0.2.0");
    const told = (version: string, at: string) => ({
      ...cache,
      notified: { version, at },
    });
    expect(pendingNotice(told("0.2.0", HOURS(3)), "0.1.0", NOW)).toBeNull();
    expect(pendingNotice(told("0.2.0", HOURS(30)), "0.1.0", NOW)).toBe("0.2.0");
    expect(pendingNotice(told("0.1.5", HOURS(3)), "0.1.0", NOW)).toBe("0.2.0");
  });
});

describe("how Ork was installed", () => {
  it.each([
    ["/usr/local/lib/node_modules/@krapht/ork/dist/bin.mjs", "npm"],
    [
      "/Users/me/.nvm/versions/node/v24.20.0/lib/node_modules/@krapht/ork/dist/bin.mjs",
      "npm",
    ],
    [
      "/Users/me/Library/pnpm/global/5/.pnpm/@krapht+ork@0.1.0/node_modules/@krapht/ork/dist/bin.mjs",
      "pnpm",
    ],
    [
      "/home/me/.local/share/pnpm/global/5/node_modules/@krapht/ork/dist/bin.mjs",
      "pnpm",
    ],
    [
      "/home/me/.config/yarn/global/node_modules/@krapht/ork/dist/bin.mjs",
      "yarn",
    ],
    [
      "/home/me/.bun/install/global/node_modules/@krapht/ork/dist/bin.mjs",
      "bun",
    ],
    [
      "/home/me/.volta/tools/image/packages/@krapht/ork/lib/node_modules/@krapht/ork/dist/bin.mjs",
      "volta",
    ],
    ["/home/me/.npm/_npx/1a2b3c/node_modules/@krapht/ork/dist/bin.mjs", "npx"],
    ["/home/me/code/ork/packages/cli/dist/bin.mjs", "source"],
    ["/home/me/code/ork/packages/cli/src/bin.ts", "source"],
    [
      String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\@krapht\ork\dist\bin.mjs`,
      "npm",
    ],
    ["/opt/ork/bin.mjs", undefined],
  ])("%s → %s", (script, id) => {
    expect(installerOf(script)).toBe(id);
  });

  it("gives each global install a command, and the rest advice", () => {
    const spec = "@krapht/ork@0.2.0";
    const npm = detectInstaller("/x/node_modules/@krapht/ork/dist/bin.mjs");
    expect(npm?.command?.(spec)).toEqual(["npm", "install", "--global", spec]);
    const script = "/home/me/code/ork/packages/cli/dist/bin.mjs";
    expect(detectInstaller(script)?.advice?.(spec, script)).toEqual({
      text: "In /home/me/code/ork: git pull, then pnpm install and pnpm build.",
      words: "In `/home/me/code/ork`, run:",
      commands: ["git pull", "pnpm install", "pnpm build"],
    });
  });

  it("gives npx its commands apart from its words", () => {
    const spec = "@krapht/ork@0.2.0";
    const script = "/home/me/.npm/_npx/1a2b/node_modules/@krapht/ork/bin.mjs";
    expect(detectInstaller(script)?.advice?.(spec, script)).toEqual({
      text: `npx keeps its own copy: run npx ${spec} …, or install it with npm install --global ${spec}.`,
      words:
        "npx keeps its own copy: run the new version through npx, or install it with npm:",
      commands: [`npx ${spec} <command>`, `npm install --global ${spec}`],
    });
  });
});
