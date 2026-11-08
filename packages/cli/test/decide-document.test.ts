/**
 * @file Tests for `ork decide --workflow` and `--document`, the `+document`
 *   mark in `--list`, and that reading a document is open to a run's own
 *   processes.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A home with live runs of `feature` (with a document) and `other`. */
const waiting = (): string => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-document-"));
  const store = openStore(storePath(home));
  for (const [id, workflow] of [
    ["r1", "feature"],
    ["r2", "other"],
  ] as const) {
    store.begin({ id, workflow, file: "/p/w.ork.yaml", project: "/p" });
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
      ...(id === "r1" ? { document: "# The spec\n\nRead me." } : {}),
    });
  }
  store.close();
  return home;
};

const ork = (
  home: string,
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: home,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      ORK_NO_UPDATE_CHECK: "1",
      ...extra,
    },
  });

describe("ork decide --list", () => {
  it("marks a decision with a document, and only that one", () => {
    const lines = ork(waiting(), ["decide", "--all", "--list"]).stdout.split(
      "\n",
    );
    expect(lines.find(line => line.includes("r1-1"))).toContain("+document");
    expect(lines.find(line => line.includes("r2-1"))).not.toContain(
      "+document",
    );
  });

  it("filters by workflow", () => {
    const { stdout } = ork(waiting(), [
      "decide",
      "--all",
      "--list",
      "--workflow",
      "feature",
    ]);
    expect(stdout).toContain("r1-1");
    expect(stdout).not.toContain("r2-1");
  });

  it("ANDs the workflow with a run id", () => {
    const { stdout } = ork(waiting(), [
      "decide",
      "r2",
      "--all",
      "--list",
      "--workflow",
      "feature",
    ]);
    expect(stdout).toContain("No open decisions in workflow feature.");
  });

  it("honors the workflow in --json", () => {
    const { stdout } = ork(waiting(), [
      "decide",
      "--all",
      "--json",
      "--workflow",
      "other",
    ]);
    expect(JSON.parse(stdout)).toMatchObject([{ id: "r2-1" }]);
  });

  it("says an unknown workflow has none", () => {
    const done = ork(waiting(), [
      "decide",
      "--all",
      "--list",
      "--workflow",
      "gone",
    ]);
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("No open decisions in workflow gone.");
  });
});

describe("ork decide --document", () => {
  it("prints the decision's document, plain", () => {
    const done = ork(waiting(), ["decide", "--id", "r1-1", "--document"]);
    expect(done.status).toBe(0);
    expect(done.stdout).toBe("# The spec\n\nRead me.\n");
  });

  it("says so and exits 1 when the decision has none", () => {
    const done = ork(waiting(), ["decide", "--id", "r2-1", "--document"]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("r2-1 has no document.");
  });

  it("goes with --id and without --choose", () => {
    const home = waiting();
    expect(ork(home, ["decide", "--document"]).status).toBe(1);
    expect(
      ork(home, ["decide", "--id", "r1-1", "--choose", "approve", "--document"])
        .stderr,
    ).toContain("--document goes with --id");
  });

  it("is open to a process inside a run, since it only reads", () => {
    const done = ork(waiting(), ["decide", "--id", "r1-1", "--document"], {
      ORK_RUN: "r9",
    });
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("Read me.");
  });
});
