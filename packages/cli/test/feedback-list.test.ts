/**
 * @file Tests for `ork feedback list` through its real command against a store
 *   in a throwaway home: dismissed items hidden by default, the shared filters
 *   (`--status`, `--kind`, `--severity`, `--workflow`, `--run`), `--ids`,
 *   `--limit`, `--json`.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { feedback } from "../src/commands/feedback.ts";
import { noteRun } from "../src/runs/feedback.ts";

type Ran = { out: string; err: string; code: number };

/** Runs `ork feedback <args>` and what it printed. */
const ork = async (...args: string[]): Promise<Ran> => {
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(text => {
    out += String(text);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    err += String(text);
    return true;
  });
  process.exitCode = undefined;
  try {
    await runCommand(feedback, { rawArgs: args });
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  const code = process.exitCode === undefined ? 0 : Number(process.exitCode);
  process.exitCode = undefined;
  return { out, err, code };
};

/**
 * Three items from two workflows' runs; `Slow` is dismissed. Returns ids by
 * title.
 */
const setup = (): Record<string, string> => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fbl-home-")));
  const project = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ork-fbl-app-")),
  );
  vi.stubEnv("HOME", home);
  vi.stubEnv("ORK_PLAIN", "1");
  const store = openStore(storePath(home));
  try {
    store.begin({
      id: "r1-full",
      workflow: "review",
      file: "w.ork.yaml",
      project,
    });
    store.begin({
      id: "r2-full",
      workflow: "build",
      file: "w.ork.yaml",
      project,
    });
    const notes = [
      { run: "r1-full", text: "Slow", kind: "friction", severity: "low" },
      { run: "r1-full", text: "Crash", kind: "bug", severity: "high" },
      { run: "r2-full", text: "Vague", kind: "friction", severity: "medium" },
    ];
    for (const note of notes) noteRun(store, project, note);
    const ids = Object.fromEntries(
      store.feedbackItems().map(item => [item.title, item.id]),
    );
    store.setFeedbackStatus(ids["Slow"] ?? "", "dismissed");
    return ids;
  } finally {
    store.close();
  }
};

const titles = (out: string): string[] =>
  ["Slow", "Crash", "Vague"].filter(title => out.includes(title));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ork feedback list", () => {
  it("hides dismissed items by default and shows them with --status all", async () => {
    setup();
    expect(titles((await ork("list")).out).toSorted()).toEqual([
      "Crash",
      "Vague",
    ]);
    expect(titles((await ork("list", "--status", "all")).out)).toHaveLength(3);
    expect(titles((await ork("list", "--status", "dismissed")).out)).toEqual([
      "Slow",
    ]);
  });

  it("filters by --kind, --severity, --workflow and --run", async () => {
    setup();
    const crash = (await ork("list", "--kind", "bug")).out;
    expect(titles(crash)).toEqual(["Crash"]);
    expect(titles((await ork("list", "--severity", "medium")).out)).toEqual([
      "Vague",
    ]);
    expect(titles((await ork("list", "--workflow", "build")).out)).toEqual([
      "Vague",
    ]);
    expect(titles((await ork("list", "--run", "r1")).out)).toEqual(["Crash"]);
  });

  it("takes a prefix for --run, and refuses an unknown or ambiguous run", async () => {
    setup();
    expect(titles((await ork("list", "--run", "r2")).out)).toEqual(["Vague"]);
    const unknown = await ork("list", "--run", "nope");
    expect(unknown.err).toContain("No run `nope`.");
    expect(unknown.out).toBe("");
    expect(unknown.code).toBe(1);
    const ambiguous = await ork("list", "--run", "r");
    expect(ambiguous.err).toContain("`r` matches 2 runs: ");
    expect(ambiguous.out).toBe("");
    expect(ambiguous.code).toBe(1);
  });

  it("prints --ids on one line, --limit cuts, --json prints rows", async () => {
    const ids = setup();
    const listed = await ork("list", "--ids", "--status", "all");
    expect(listed.out.trim().split(",").toSorted()).toEqual(
      Object.values(ids).toSorted(),
    );
    expect(listed.out.trim().split("\n")).toHaveLength(1);
    expect((await ork("list", "--ids", "--kind", "idea")).out).toBe("");
    const limited = await ork("list", "--ids", "--limit", "1");
    expect(limited.out.trim().split(",")).toHaveLength(1);
    const json = await ork("list", "--json", "--limit", "1");
    expect(JSON.parse(json.out)).toHaveLength(1);
  });

  it.each(["0", "-1", "abc", "2.5"])("refuses --limit %s", async limit => {
    setup();
    const bad = await ork("list", "--limit", limit);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--limit takes a positive whole number");
  });

  it("refuses a bad value, and --ids with --json", async () => {
    setup();
    // citty refuses an enum value itself, naming the flag and the choices.
    await expect(ork("list", "--status", "gone")).rejects.toThrow(
      "--status (gone). Expected one of: new, triaged",
    );
    const both = await ork("list", "--ids", "--json");
    expect(both.code).toBe(1);
    expect(both.err).toContain("--ids and --json can't be used together");
  });

  it("takes --status all for every item", async () => {
    setup();
    const all = await ork("list", "--status", "all");
    expect(titles(all.out)).toHaveLength(3);
  });
});
