/**
 * @file Tests for `ork decide --say`: the answer's note is stored with it and
 *   said back, it goes only with `--id` and `--choose`, and `--note` still
 *   records feedback rather than the answer's note.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, storePath } from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");

/** A home whose store has run `r1` waiting on decision `r1-1`. */
const waiting = (): string => {
  const home = mkdtempSync(path.join(tmpdir(), "ork-say-"));
  const store = openStore(storePath(home));
  store.begin({
    id: "r1",
    workflow: "w",
    file: "/p/w.ork.yaml",
    project: "/p",
  });
  store.append("r1", {
    type: "node.started",
    id: "approve",
    nodeType: "human.gate",
    round: 1,
  });
  store.openDecision({
    id: "r1-1",
    runId: "r1",
    node: "approve",
    kind: "question",
    question: "Approve the spec?",
    options: [{ id: "approve" }, { id: "revise" }],
  });
  store.close();
  return home;
};

const ork = (home: string, args: readonly string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: home,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      ORK_NO_UPDATE_CHECK: "1",
    },
  });

/** The decision as the store has it now. */
const decisionIn = (home: string) => {
  const store = openStore(storePath(home));
  const decision = store.decision("r1-1");
  store.close();
  return decision;
};

describe("ork decide --say", () => {
  it("answers with a note, and says it back", () => {
    const home = waiting();
    const done = ork(home, [
      "decide",
      "--id",
      "r1-1",
      "--choose",
      "revise",
      "--say",
      "Cut the API section",
    ]);
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("r1-1: revise · said: Cut the API section");
    expect(decisionIn(home)).toMatchObject({
      status: "answered",
      answer: "revise",
      answeredBy: "decide",
      note: "Cut the API section",
    });
  });

  it("goes only with --id and --choose", () => {
    const home = waiting();
    const done = ork(home, ["decide", "--say", "Cut it"]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("--say goes with --id and --choose");
    expect(decisionIn(home)?.status).toBe("open");
  });

  it("keeps --note for feedback, not for the run", () => {
    const home = waiting();
    const done = ork(home, [
      "decide",
      "--id",
      "r1-1",
      "--choose",
      "approve",
      "--note",
      "The spec was clear",
    ]);
    expect(done.stderr).toBe("");
    expect(done.stdout).toContain("noted in item");
    expect(decisionIn(home)).not.toHaveProperty("note");
  });
});
