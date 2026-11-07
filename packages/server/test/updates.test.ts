/**
 * @file Tests for what the server knows of new versions: the record it reads,
 *   off by the CLI's switches; the daily check it runs itself, at most once a
 *   day by the shared record; and the overview stream's `version`. The registry
 *   is a fake `fetch`; nothing reaches the network.
 */

import { setTimeout as sleep } from "node:timers/promises";

import {
  readUpdateCache,
  updateCachePath,
  writeUpdateCache,
} from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { createUpdates, type Updates } from "../src/updates.ts";
import {
  fakeRegistry,
  readSse,
  startTestServer,
  type TestServer,
  temp,
  text,
} from "./fixtures.ts";

const NAME = "@krapht/ork";

const CANARY_OLD = "1.0.0-canary-20261101090000-1a2b3c4";
const CANARY_NEW = "1.0.0-canary-20261107090000-5d6e7f8";

const opened: Updates[] = [];
let fixture: TestServer | undefined;
const stops: AbortController[] = [];

afterEach(async () => {
  for (const updates of opened.splice(0)) updates.close();
  for (const stop of stops.splice(0)) stop.abort();
  await fixture?.close();
  fixture = undefined;
});

const open = (
  home: string,
  over: Partial<Parameters<typeof createUpdates>[0]["options"]> = {},
  registry = fakeRegistry("9.9.10"),
) => {
  const updates = createUpdates({
    version: "9.9.9",
    home,
    options: { name: NAME, env: {}, fetch: registry.fetch, ...over },
  });
  opened.push(updates);
  return { updates, registry };
};

const recorded = (home: string, latest: string, hoursAgo = 0) => {
  const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  writeUpdateCache(updateCachePath(home), { checkedAt: at, latest });
};

describe("what the server knows of versions", () => {
  it("reports a newer version the record knows, with its release notes", () => {
    const home = temp("ork-srv-up-");
    recorded(home, "9.10.0");
    const { updates } = open(home);
    expect(updates.info()).toMatchObject({
      current: "9.9.9",
      latest: "9.10.0",
      newer: "9.10.0",
      releaseNotes: text("%40krapht%2Fork%409.10.0"),
      check: { on: true },
      registry: null,
      job: null,
    });
  });

  it("reports nothing newer, and says why, when the check is off", () => {
    const home = temp("ork-srv-up-");
    recorded(home, "9.10.0");
    expect(open(home, { env: { CI: "1" } }).updates.info()).toMatchObject({
      latest: "9.10.0",
      newer: null,
      releaseNotes: null,
      check: { on: false, reason: "CI is set" },
    });
    expect(
      open(home, { env: { ORK_NO_UPDATE_CHECK: "true" } }).updates.info().check,
    ).toEqual({ on: false, reason: "ORK_NO_UPDATE_CHECK is set" });
  });

  it("is off in a server `ork ui` did not start", () => {
    const updates = createUpdates({ version: "9.9.9" });
    expect(updates.info()).toMatchObject({
      newer: null,
      check: { on: false, reason: "This server was not started by `ork ui`." },
    });
  });

  it("names a registry other than npm's", () => {
    const { updates } = open(temp("ork-srv-up-"), {
      env: { ORK_UPDATE_REGISTRY: "https://registry.example" },
    });
    expect(updates.info().registry).toBe("https://registry.example");
  });

  it("never shows the user name and password a mirror's URL carries", () => {
    const { updates } = open(temp("ork-srv-up-"), {
      env: { ORK_UPDATE_REGISTRY: "https://jo:s3cret@mirror.example/npm/" },
    });
    expect(updates.info().registry).toBe("https://mirror.example/npm/");
  });
});

describe("the daily check in a long-running server", () => {
  it("asks the registry when a check is due, and records the answer", async () => {
    const home = temp("ork-srv-up-");
    const { updates, registry } = open(home);
    await expect
      .poll(() => readUpdateCache(updateCachePath(home))?.latest)
      .toBe("9.9.10");
    expect(registry.asked).toEqual([
      `https://registry.npmjs.org/-/package/${NAME}/dist-tags`,
    ]);
    expect(updates.info().newer).toBe("9.9.10");
  });

  it.each([
    ["a canary follows the canary tag", CANARY_OLD, CANARY_NEW],
    ["an alpha never does", "1.0.0-alpha.0", "1.0.0-alpha.1"],
  ])("%s", async (_case, version, newest) => {
    const home = temp("ork-srv-up-");
    const registry = fakeRegistry("1.0.0-alpha.1", { canary: CANARY_NEW });
    opened.push(
      createUpdates({
        version,
        home,
        options: { name: NAME, env: {}, fetch: registry.fetch },
      }),
    );
    await expect
      .poll(() => readUpdateCache(updateCachePath(home))?.latest)
      .toBe(newest);
  });

  it("doesn't ask when the record is less than a day old", async () => {
    const home = temp("ork-srv-up-");
    recorded(home, "9.9.9", 23);
    const { registry } = open(home, { checkEveryMs: 10 });
    await sleep(50);
    expect(registry.asked).toEqual([]);
  });

  it("never asks with the check off", async () => {
    const { registry } = open(temp("ork-srv-up-"), { env: { CI: "1" } });
    await sleep(20);
    expect(registry.asked).toEqual([]);
  });
});

describe("the overview stream's version", () => {
  it("sends what is known first, and again when the record changes", async () => {
    fixture = await startTestServer({
      update: {
        name: NAME,
        env: { ORK_NO_UPDATE_CHECK: "" },
        fetch: fakeRegistry("9.9.9").fetch,
        readEveryMs: 0,
      },
    });
    const stop = new AbortController();
    stops.push(stop);
    const response = await fixture.get("/api/stream");
    const stream = readSse(response, stop.signal);
    const versions = () =>
      stream.seen.filter(e => e.event === "version").map(e => e.data);
    // The check at start finds 9.9.9, this server's own version.
    await expect
      .poll(() => versions().at(-1))
      .toMatchObject({ current: "9.9.9", latest: "9.9.9", newer: null });
    recorded(fixture.home, "10.0.0");
    await expect
      .poll(() => versions().at(-1), { timeout: 3000 })
      .toMatchObject({ newer: "10.0.0" });
  });
});
