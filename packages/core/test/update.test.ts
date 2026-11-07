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
  isCanary,
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

const CANARY_OLD = "1.0.0-canary-20261101090000-1a2b3c4";
const CANARY_NEW = "1.0.0-canary-20261107090000-5d6e7f8";

/** What the check takes from these dist-tags, for the running `current`. */
const newestFor = (tags: unknown, current?: string) =>
  fetchLatest("x", {
    fetch: fakeFetch(tags).fetch,
    ...(current === undefined ? {} : { current }),
  });

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

  it.each([
    [
      "only latest, as before the channels",
      { latest: "0.4.0" },
      undefined,
      "0.4.0",
    ],
    [
      "an alpha above latest",
      { latest: "0.4.0", alpha: "1.0.0-alpha.1" },
      "0.4.0",
      "1.0.0-alpha.1",
    ],
    [
      "the newest of every channel",
      {
        latest: "1.0.0-beta.0",
        alpha: "1.0.0-alpha.3",
        beta: "1.0.0-beta.0",
        rc: "1.0.0-rc.1",
      },
      "1.0.0-alpha.3",
      "1.0.0-rc.1",
    ],
    [
      "a tag that doesn't parse, or isn't text, skipped",
      { latest: "0.4.0", alpha: "soon", beta: 7, rc: null },
      undefined,
      "0.4.0",
    ],
    [
      "a tag outside the channels, skipped",
      { latest: "0.4.0", next: "9.0.0" },
      undefined,
      "0.4.0",
    ],
    [
      "no canary for an alpha",
      { latest: "1.0.0-alpha.1", alpha: "1.0.0-alpha.1", canary: CANARY_NEW },
      "1.0.0-alpha.0",
      "1.0.0-alpha.1",
    ],
    [
      "no canary when the running version is unknown",
      { latest: "0.4.0", canary: CANARY_NEW },
      undefined,
      "0.4.0",
    ],
    [
      "a newer canary for a canary",
      { latest: "1.0.0-alpha.1", alpha: "1.0.0-alpha.1", canary: CANARY_NEW },
      CANARY_OLD,
      CANARY_NEW,
    ],
    [
      "a newer rc for a canary, when that's higher",
      { latest: "1.0.0-rc.0", rc: "1.0.0-rc.0", canary: CANARY_NEW },
      CANARY_OLD,
      "1.0.0-rc.0",
    ],
    ["nothing when no tag parses", { latest: "soon" }, undefined, null],
  ])("takes %s", async (_case, tags, current, newest) => {
    await expect(newestFor(tags, current)).resolves.toBe(newest);
  });

  it.each([
    [CANARY_NEW, true],
    ["1.0.0-canary.3", true],
    ["1.0.0-alpha.1", false],
    ["1.0.0", false],
    ["canary", false],
  ])("%s is a canary: %s", (version, canary) => {
    expect(isCanary(version)).toBe(canary);
  });

  it("records the newest a canary follows", async () => {
    const file = tempCache();
    await refreshUpdateCache(file, "x", NOW, {
      fetch: fakeFetch({ latest: "1.0.0-alpha.1", canary: CANARY_NEW }).fetch,
      current: CANARY_OLD,
    });
    expect(readUpdateCache(file)?.latest).toBe(CANARY_NEW);
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
      "/Users/me/Library/pnpm/store/v11/links/@krapht/ork/0.3.0/4774/node_modules/@krapht/ork/dist/bin.mjs",
      "pnpm",
    ],
    [
      String.raw`C:\Users\me\AppData\Local\pnpm\store\v11\links\@krapht\ork\0.3.0\4774\node_modules\@krapht\ork\dist\bin.mjs`,
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
