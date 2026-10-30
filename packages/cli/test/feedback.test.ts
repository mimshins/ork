/**
 * @file Tests for feedback in `ork run` and `ork feedback`: a run records the
 *   signals its events show (an answer other than the recommended one), with
 *   Ork's version and the workflow's hash, and `list`, `show` and `dismiss`
 *   read them back.
 */

import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type HumanChannel, openStore } from "@krapht/ork-core";
import { createCliRuntime } from "@krapht/ork-runtime-claude";
import { describe, expect, it } from "vitest";

import {
  feedbackOrigin,
  findFeedbackItem,
  formatFeedbackItem,
  formatFeedbackItems,
  runWorkflowFile,
} from "../src/index.ts";

const FAKE_CLAUDE = path.resolve(
  import.meta.dirname,
  "../../runtime-claude/test/fixtures/fake-claude.mjs",
);

const WORKFLOW = [
  "schemaVersion: 1",
  "name: notes",
  "nodes:",
  "  write:",
  "    type: claude.worker",
  "    isolation: shared",
  '    prompt: "Write notes"',
  "",
].join("\n");

/** Answers every question with `b`; the fake recommends `a`. */
const contrary: HumanChannel = {
  ask: () => Promise.resolve("b"),
  permit: () => Promise.resolve({ allow: true }),
};

const NOW = Date.parse("2030-01-01T00:00:00Z");

const only = <T>(items: readonly T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error("none");
  return item;
};

describe("feedback in a run", () => {
  it("records what the run's events signal, and ork feedback reads it", async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fb-")));
    writeFileSync(path.join(dir, "notes.ork.yaml"), WORKFLOW);
    const store = openStore(":memory:");
    const out: string[] = [];
    await runWorkflowFile({
      file: "notes.ork.yaml",
      cwd: dir,
      inputs: [],
      inPlace: true,
      json: false,
      runtime: () => Promise.resolve(createCliRuntime({ bin: FAKE_CLAUDE })),
      human: contrary,
      store,
      home: mkdtempSync(path.join(tmpdir(), "ork-home-")),
      out: line => {
        out.push(line);
      },
      err: () => {
        // The run's result is checked instead.
      },
    });
    expect(out).toContain(
      "write │ ✎ feedback (workflow, context-gap): The answer to write's question was not the one it recommended",
    );

    const [item] = store.feedbackItems();
    expect(item).toMatchObject({
      count: 1,
      status: "new",
      workflows: ["notes"],
    });
    const origin = feedbackOrigin(path.join(dir, "notes.ork.yaml"));
    expect(origin.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(origin.workflowHash).toMatch(/^[0-9a-f]{12}$/u);
    const id = String(item?.id);
    expect(store.feedbackRecords(id)[0]?.feedback.origin).toMatchObject({
      ...origin,
      workflow: "notes",
      nodeType: "claude.worker",
      driver: "cli",
    });

    const found = findFeedbackItem(store, id.slice(0, 4));
    expect(found.ok).toBe(true);
    expect(findFeedbackItem(store, "zzzz")).toEqual({
      ok: false,
      error: "No feedback item zzzz; see ork feedback list.",
    });
    expect(formatFeedbackItems(store.feedbackItems(), NOW)[0]).toContain(
      `${id}   1× workflow/context-gap  The answer to write's question was not the one it recommended · `,
    );
    const shown = formatFeedbackItem(
      only(store.feedbackItems()),
      store.feedbackRecords(id),
      NOW,
    );
    expect(shown[0]).toBe(
      "The answer to write's question was not the one it recommended",
    );
    expect(shown).toContain(
      "  Asked: Which approach? Recommended: a. Answered: b.",
    );
    store.setFeedbackStatus(id, "dismissed");
    expect(formatFeedbackItems(store.feedbackItems(), NOW)).toEqual([
      "No feedback yet.",
    ]);
  });
});
