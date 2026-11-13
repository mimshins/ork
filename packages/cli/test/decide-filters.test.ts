/**
 * @file Tests for the list filters of `ork decide` (RFC-017): `--project`,
 *   `--run`, `--ids`, `--limit`, the hidden `--all`, and that `--ids` and
 *   `--limit` list instead of answering.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { runCommand } from "citty";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asksForList } from "../src/commands/decide-list.ts";
import { decide } from "../src/commands/decide.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A home with live runs r1 and r2 of two workflows, in two projects. */
const waiting = (): string => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-decide-filters-"));
  const store = openStore(storePath(home));
  for (const [id, workflow, project] of [
    ["r1", "feature", "/p"],
    ["r2", "other", "/q"],
  ] as const) {
    store.begin({ id, workflow, file: "/p/w.ork.yaml", project });
    store.append(id, {
      type: "node.started",
      id: "approve",
      nodeType: "human.gate",
      round: 1,
    });
    store.openDecision({
      id: `${id}-1`,
      runId: id,
      node: "approve",
      kind: "question",
      question: "Approve?",
      options: [{ id: "approve" }],
    });
  }
  store.close();
  return home;
};

const ork = (home: string, args: readonly string[]) =>
  spawnSync(process.execPath, [BIN, "decide", ...args], {
    cwd: home,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

describe("ork decide list filters", () => {
  it("--ids prints the ids on one line, with --project all", () => {
    const done = ork(waiting(), ["--project", "all", "--ids"]);
    expect(done.status).toBe(0);
    expect(done.stdout).toBe("r1-1,r2-1\n");
  });

  it("--ids prints nothing for an empty result", () => {
    const done = ork(waiting(), ["--ids"]);
    expect(done.status).toBe(0);
    expect(done.stdout).toBe("");
  });

  it("refuses --ids with --json", () => {
    const done = ork(waiting(), ["--project", "all", "--ids", "--json"]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("--ids and --json can't be used together.");
  });

  it("--limit keeps the first N, after filtering", () => {
    const done = ork(waiting(), ["--project", "all", "--ids", "--limit", "1"]);
    expect(done.stdout).toBe("r1-1\n");
  });

  it.each(["0", "-1", "abc", "2.5"])("refuses --limit %s", limit => {
    const done = ork(waiting(), ["--project", "all", "--limit", limit]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("--limit takes a positive whole number");
  });

  it("--workflow and --run narrow the list", () => {
    const home = waiting();
    expect(
      ork(home, ["--project", "all", "--workflow", "other", "--ids"]).stdout,
    ).toBe("r2-1\n");
    expect(ork(home, ["--run", "r1", "--ids"]).stdout).toBe("r1-1\n");
    expect(ork(home, ["r2", "--ids"]).stdout).toBe("r2-1\n");
  });

  it("refuses an unregistered --project, naming the registered ones", () => {
    const done = ork(waiting(), ["--project", "nope", "--ids"]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("No registered project `nope`");
  });

  it("--all still means --project all, with one warning", () => {
    const done = ork(waiting(), ["--all", "--ids"]);
    expect(done.stdout).toBe("r1-1,r2-1\n");
    expect(done.stderr).toBe("--all is deprecated; use --project all.\n");
  });
});

describe("asksForList", () => {
  it.each([
    [{ ids: true }],
    [{ limit: "1" }],
    [{ list: true }],
    [{ json: true }],
  ])("is true for %j", args => {
    expect(asksForList(args)).toBe(true);
  });

  it("is false with none of them", () => {
    expect(asksForList({})).toBe(false);
    expect(asksForList({ ids: false, json: false, list: false })).toBe(false);
  });
});

const answering = vi.hoisted(() => ({
  askStored: vi.fn<() => Promise<{ kind: string; message: string }>>(() =>
    Promise.resolve({ kind: "refused", message: "stub" }),
  ),
  decideRefusal: vi.fn<() => string | null>(() => null),
}));

vi.mock("../src/runs/ask-stored.ts", () => ({
  askStored: answering.askStored,
}));
vi.mock("../src/commands/in-a-run.ts", () => ({
  decideRefusal: answering.decideRefusal,
}));

/** What `ork decide <args>` prints in this process, on a terminal. */
const onATerminal = async (home: string, args: string[]): Promise<string> => {
  const chunks: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    chunks.push(String(chunk));
    return true;
  });
  const homeBefore = process.env["HOME"];
  process.env["HOME"] = home;
  // Forced either way, so the worker's own stdin (a TTY or closed) can't matter.
  const before = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  try {
    await runCommand(decide, { rawArgs: ["--project", "all", ...args] });
  } finally {
    if (before === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
    else Object.defineProperty(process.stdin, "isTTY", before);
    process.env["HOME"] = homeBefore;
    out.mockRestore();
  }
  return chunks.join("");
};

describe("ork decide on a terminal", () => {
  beforeEach(() => {
    answering.askStored.mockClear();
    answering.decideRefusal.mockClear();
  });

  it.each([[["--ids"]], [["--limit", "1"]], [["--json"]]])(
    "lists, and never answers, with %j",
    async args => {
      const printed = await onATerminal(waiting(), args);
      expect(printed).toContain("r1-1");
      expect(answering.askStored).not.toHaveBeenCalled();
      expect(answering.decideRefusal).not.toHaveBeenCalled();
    },
  );

  it("asks when no flag shapes a list", async () => {
    await onATerminal(waiting(), []);
    expect(answering.askStored).toHaveBeenCalled();
  });
});
