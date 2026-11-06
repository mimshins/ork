/**
 * @file Tests for `ork feedback accept`: accepting marks an item, `--lesson`
 *   writes it into the lessons of the workflow it was seen in, in that run's
 *   project; an `ork` item isn't a lesson, and an item seen in two workflows
 *   needs `--workflow`.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  type FeedbackItem,
  humanNoteEvent,
  openStore,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { acceptItem } from "../src/runs/accept.ts";

/** A project with a run of each workflow, each noting `title` (`kind`). */
const noted = (
  workflows: readonly string[],
  title = "Say where the spec is",
  kind: "context-gap" | "bug" = "context-gap",
  within: string = tmpdir(),
) => {
  const root = realpathSync(mkdtempSync(path.join(within, "ork-accept-")));
  mkdirSync(path.join(root, ".git"));
  mkdirSync(path.join(root, ".ork", "workflows"), { recursive: true });
  const store = openStore(":memory:");
  for (const [index, workflow] of workflows.entries()) {
    const id = `run${String(index)}`;
    store.begin({
      id,
      workflow,
      file: path.join(root, ".ork", "workflows", `${workflow}.ork.yaml`),
      project: root,
    });
    store.append(id, humanNoteEvent({ text: title, workflow, kind }));
  }
  return { root, store, item: theItem(store) };
};

const theItem = (store: EventStore): FeedbackItem => {
  const [item] = store.feedbackItems();
  if (item === undefined) throw new Error("No item.");
  return item;
};

/** What `accept` says, or why it refused, as an error. */
const linesOf = (accepted: ReturnType<typeof acceptItem>): string[] => {
  if (!accepted.ok) throw new Error(accepted.error);
  return accepted.lines;
};

const lessonsOf = (root: string, workflow: string): string =>
  readFileSync(path.join(root, ".ork", "lessons", `${workflow}.md`), "utf8");

describe("ork feedback accept", () => {
  it("marks the item accepted, and writes no lesson without --lesson", () => {
    const { root, store, item } = noted(["notes"]);
    expect(acceptItem(store, item, { lesson: false }, []).ok).toBe(true);
    expect(theItem(store).status).toBe("accepted");
    expect(existsSync(path.join(root, ".ork", "lessons"))).toBe(false);
  });

  it("writes a lesson into its workflow's file, in the run's project", () => {
    const { root, store, item } = noted(["notes"]);
    const accepted = acceptItem(
      store,
      item,
      {
        lesson: true,
        text: "The spec is at nodes.spec.output.artifacts.spec.",
      },
      [],
    );
    expect(linesOf(accepted)[1]).toMatch(
      /^lesson added to \.ork\/lessons\/notes\.md in .+ \(about \d+ of 1,500 tokens\)/u,
    );
    expect(lessonsOf(root, "notes")).toContain(
      "- The spec is at nodes.spec.output.artifacts.spec. <!-- feedback ",
    );
    expect(theItem(store).status).toBe("accepted");
  });

  it("takes the item's title when given no words, and only once", () => {
    const { root, store, item } = noted(["notes"]);
    acceptItem(store, item, { lesson: true }, []);
    expect(lessonsOf(root, "notes")).toContain("- Say where the spec is <!--");
    const again = acceptItem(store, item, { lesson: true }, []);
    expect(again.ok).toBe(false);
  });

  it("never makes an item about Ork a lesson", () => {
    const { store, item } = noted(["notes"], "The tool crashed", "bug");
    const accepted = acceptItem(store, item, { lesson: true }, []);
    expect(accepted).toEqual({
      ok: false,
      error: `${item.id.slice(0, 12)} is about Ork itself, so it isn't a lesson for a workflow; share it with Ork's maintainers instead.`,
    });
    expect(theItem(store).status).toBe("new");
  });

  it("refuses a project that is no longer a repository of its own", () => {
    // A monorepo above the project, in the test's own folder.
    const outer = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-outer-")));
    mkdirSync(path.join(outer, ".git"));
    const { root, store, item } = noted(["notes"], undefined, undefined, outer);
    rmSync(path.join(root, ".git"), { recursive: true });
    const accepted = acceptItem(store, item, { lesson: true }, []);
    expect(accepted).toEqual({
      ok: false,
      error: `Its project at ${root} isn't a project any more: Ork would take it for ${outer}.`,
    });
    expect(existsSync(path.join(outer, ".ork"))).toBe(false);
  });

  it("asks which workflow when it was seen in two", () => {
    const { root, store, item } = noted(["notes", "other"]);
    expect(acceptItem(store, item, { lesson: true }, [])).toEqual({
      ok: false,
      error: `${item.id.slice(0, 12)} was seen in \`notes\`, \`other\`: name one with --workflow.`,
    });
    expect(
      acceptItem(store, item, { lesson: true, workflow: "other" }, []).ok,
    ).toBe(true);
    expect(lessonsOf(root, "other")).toContain("- Say where the spec is");
    expect(
      acceptItem(store, item, { lesson: true, workflow: "elsewhere" }, []),
    ).toEqual({
      ok: false,
      error: `${item.id.slice(0, 12)} wasn't seen in \`elsewhere\`, only in \`notes\`, \`other\`.`,
    });
  });
});
