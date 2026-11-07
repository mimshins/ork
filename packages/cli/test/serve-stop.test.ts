/**
 * @file Tests for how `ork ui --serve` stops (ADR-060): with an upgrade
 *   running, it says on the terminal that it waits, and lets the server close
 *   only once the installer has exited, so stopping `ork ui` can't leave `ork`
 *   half-installed; with none, it says nothing and doesn't wait. The installer
 *   is a fake the test finishes.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { upgradeFinished, WAITING_FOR_UPGRADE } from "../src/browser/serve.ts";

const ignore = (): void => {};

/** An installer the test finishes, behind a server's `upgrading`. */
const fakeUpgrade = () => {
  let finish: () => void = ignore;
  const done = new Promise<void>(resolve => {
    finish = resolve;
  });
  return { server: { upgrading: () => done }, finish };
};

describe("stopping `ork ui --serve`", () => {
  it("waits for a running upgrade to finish, and says so", async () => {
    const upgrade = fakeUpgrade();
    const said: string[] = [];
    let closed = false;
    const stopping = upgradeFinished(upgrade.server, line => {
      said.push(line);
    }).then(() => {
      closed = true;
      return closed;
    });
    await sleep(20);
    expect(said).toEqual([
      "Waiting for the upgrade to finish… Press Ctrl-C again to stop now.",
    ]);
    expect(said).toEqual([WAITING_FOR_UPGRADE]);
    expect(closed).toBe(false);
    upgrade.finish();
    await stopping;
    expect(closed).toBe(true);
  });

  it("says nothing and doesn't wait when no upgrade runs", async () => {
    const said: string[] = [];
    await upgradeFinished({ upgrading: () => null }, line => {
      said.push(line);
    });
    expect(said).toEqual([]);
  });
});
