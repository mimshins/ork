/**
 * @file Tests for how `ork run` wires the `permission.suggest` signal: the
 *   observer `signalsOf` builds reads the project's answered permissions from
 *   the store, checks them against the project file's `permissions.allow`, and
 *   names that file in the proposal.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  inRepoPlace,
  openStore,
  type RunEvent,
} from "@krapht/ork-core";
import type { Workflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { signalsOf } from "../src/run/origin.ts";

const RULE = "Bash(git log *)";
const WORKFLOW: Workflow = { schemaVersion: 1, name: "w", nodes: {} };

/** A project folder with `.ork/project.yaml` holding `allow`. */
const project = (allow: readonly string[]): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-suggest-")));
  mkdirSync(path.join(root, ".ork"));
  writeFileSync(
    path.join(root, ".ork", "project.yaml"),
    [
      "schemaVersion: 1",
      "permissions:",
      "  allow:",
      ...allow.map(rule => `    - "${rule}"`),
      "",
    ].join("\n"),
  );
  return root;
};

/** Opens and answers an allowed `git log` prompt; the events its run records. */
const allowed = (
  store: EventStore,
  runId: string,
  id: string,
  file: string,
): RunEvent[] => {
  const options = [
    { id: "allow", label: "Allow once" },
    {
      id: "allow-always",
      label: "Allow always",
      description: `${RULE} in ${file}`,
    },
    { id: "deny", label: "Deny" },
  ];
  store.openDecision({
    id,
    runId,
    node: "spec",
    kind: "permission",
    question: "Allow Bash?",
    options,
    context: "git log -1 --oneline",
  });
  store.answerDecision(id, "allow", "terminal");
  return [
    {
      type: "decision.opened",
      node: "spec",
      decision: id,
      kind: "permission",
      question: "Allow Bash?",
      options,
    },
    {
      type: "decision.answered",
      node: "spec",
      decision: id,
      answer: "allow",
      by: "terminal",
    },
  ];
};

/**
 * The `permission.suggest` evidence a run in `root` records after 3 allows
 * across 2 runs.
 */
const suggested = (root: string): string[][] => {
  const store = openStore(":memory:");
  for (const id of ["r1", "r2"]) {
    store.begin({
      id,
      workflow: "w",
      file: `${root}/w.ork.yaml`,
      project: root,
    });
  }
  const file = path.join(root, ".ork", "project.yaml");
  const signals = signalsOf(
    { cwd: root, file: "w.ork.yaml", store },
    WORKFLOW,
    inRepoPlace(root),
  );
  return [
    ...allowed(store, "r1", "d1", file),
    ...allowed(store, "r1", "d2", file),
    ...allowed(store, "r2", "d3", file),
  ]
    .flatMap(event => signals(event))
    .flatMap(event =>
      event.type === "feedback.recorded" &&
      event.feedback.code === "permission.suggest"
        ? [event.feedback.evidence ?? []]
        : [],
    );
};

describe("signalsOf's permission history", () => {
  it("proposes a rule from the store's answers, for the project's rules file", () => {
    const root = project(["Bash(ls *)"]);
    expect(suggested(root)).toEqual([
      [RULE, path.join(root, ".ork", "project.yaml")],
    ]);
  });

  it("proposes nothing the project file already allows", () => {
    expect(suggested(project(["Bash(git *)"]))).toEqual([]);
  });
});
