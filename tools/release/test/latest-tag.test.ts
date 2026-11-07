/**
 * @file Tests for moving npm's `latest` to a just-published pre-release
 *   (`tools/release/latest-tag.ts`), against a fake `npm`: only for an alpha,
 *   beta or rc that npm has, never for a canary or a plain release, and not
 *   again once `latest` is there.
 */

import { describe, expect, it } from "vitest";

import {
  channelOf,
  moveLatest,
  type Npm,
  outcomeLine,
  parseDistTags,
} from "../latest-tag.ts";

/** A fake npm: the versions it has, its dist-tags; records every call. */
const fakeNpm = (
  versions: readonly string[],
  tags: Record<string, string>,
  addFails = false,
) => {
  const calls: string[] = [];
  const npm: Npm = args => {
    calls.push(args.join(" "));
    const [command, sub] = args;
    const spec = args.find(arg => arg.startsWith("@krapht/ork@")) ?? "";
    const version = spec.slice(spec.lastIndexOf("@") + 1);
    const has = versions.includes(version);
    const answers: Record<string, () => { ok: boolean; stdout: string }> = {
      view: () => ({ ok: true, stdout: has ? `${version}\n` : "" }),
      "dist-tag ls": () => ({
        ok: true,
        stdout: Object.entries(tags)
          .map(([tag, value]) => `${tag}: ${value}`)
          .join("\n"),
      }),
      "dist-tag add": () => ({ ok: !addFails, stdout: "" }),
    };
    const answer = answers[command === "view" ? "view" : `${command} ${sub}`];
    return answer?.() ?? { ok: false, stdout: "" };
  };
  return { npm, calls };
};

const ADD = (version: string) => `dist-tag add @krapht/ork@${version} latest`;

describe("the release's latest tag", () => {
  it.each([
    ["1.0.0-alpha.0", "alpha"],
    ["1.0.0-beta.3", "beta"],
    ["1.0.0-rc.1", "rc"],
    ["1.0.0-alpha", "alpha"],
    ["1.0.0", undefined],
    ["0.4.1", undefined],
    ["1.0.0-canary-20261107090000-5d6e7f8", undefined],
    ["1.0.0-alphabet.1", undefined],
  ])("%s is on channel %s", (version, channel) => {
    expect(channelOf(version)).toBe(channel);
  });

  it("reads npm's dist-tags", () => {
    expect(parseDistTags("alpha: 1.0.0-alpha.1\nlatest: 0.4.0\n\n")).toEqual({
      alpha: "1.0.0-alpha.1",
      latest: "0.4.0",
    });
  });

  it("moves latest to a published alpha, beta or rc", async () => {
    const { npm, calls } = fakeNpm(["0.4.0", "1.0.0-alpha.1"], {
      latest: "0.4.0",
      alpha: "1.0.0-alpha.1",
    });
    const outcome = await moveLatest("1.0.0-alpha.1", { npm });
    expect(outcome).toEqual({
      kind: "moved",
      version: "1.0.0-alpha.1",
      from: "0.4.0",
    });
    expect(calls.at(-1)).toBe(ADD("1.0.0-alpha.1"));
    expect(outcomeLine(outcome)).toBe(
      "Moved latest to 1.0.0-alpha.1 (from 0.4.0).",
    );
  });

  it("does nothing once latest is there", async () => {
    const { npm, calls } = fakeNpm(["1.0.0-rc.0"], { latest: "1.0.0-rc.0" });
    expect(await moveLatest("1.0.0-rc.0", { npm })).toEqual({
      kind: "skipped",
      reason: "latest is already 1.0.0-rc.0",
    });
    expect(calls).not.toContain(ADD("1.0.0-rc.0"));
  });

  it.each([
    ["a canary", "1.0.0-canary-20261107090000-5d6e7f8"],
    ["a plain release", "1.0.0"],
  ])("never moves it to %s, nor asks npm", async (_case, version) => {
    const { npm, calls } = fakeNpm([version], { latest: "0.4.0" });
    expect((await moveLatest(version, { npm })).kind).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("never moves it to a version npm doesn't have, after asking a few times", async () => {
    const { npm, calls } = fakeNpm(["0.4.0"], { latest: "0.4.0" });
    let waits = 0;
    const outcome = await moveLatest("1.0.0-beta.0", {
      npm,
      attempts: 3,
      wait: () => {
        waits += 1;
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({
      kind: "skipped",
      reason: "npm doesn't have @krapht/ork@1.0.0-beta.0",
    });
    expect(calls).toEqual([
      "view @krapht/ork@1.0.0-beta.0 version",
      "view @krapht/ork@1.0.0-beta.0 version",
      "view @krapht/ork@1.0.0-beta.0 version",
    ]);
    expect(waits).toBe(2);
  });

  it("only says what it would do in a dry run", async () => {
    const { npm, calls } = fakeNpm(["1.0.0-alpha.0"], { latest: "0.4.0" });
    expect(await moveLatest("1.0.0-alpha.0", { npm, dryRun: true })).toEqual({
      kind: "would-move",
      version: "1.0.0-alpha.0",
      from: "0.4.0",
    });
    expect(calls).not.toContain(ADD("1.0.0-alpha.0"));
  });

  it("says so when npm refuses the move", async () => {
    const { npm } = fakeNpm(["1.0.0-alpha.0"], { latest: "0.4.0" }, true);
    expect(await moveLatest("1.0.0-alpha.0", { npm })).toEqual({
      kind: "failed",
      reason: "npm dist-tag add failed for 1.0.0-alpha.0",
    });
  });
});
