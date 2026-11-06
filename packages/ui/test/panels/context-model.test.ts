/**
 * @file Tests for the Context panel's model: the six sections and their sums, a
 *   failed ask in a sentence, the planner's words as a sentence, and the
 *   command typed from the project's root.
 */

import { describe, expect, it } from "vitest";

import {
  failedWords,
  fromRoot,
  linesOf,
  sectionsOf,
  sentence,
} from "../../src/panels/context-model.ts";
import { EXPLANATION } from "./context-fixtures.ts";

describe("the Context panel's model", () => {
  it("gives each section its sum, never a total across them", () => {
    expect(
      sectionsOf(EXPLANATION).map(({ title, meta }) => [title, meta]),
    ).toEqual([
      ["Agent", "≈12"],
      ["Project instructions", "≈3"],
      ["Skills", "1 live, 1 off"],
      ["Context files", "1 file · ≈3"],
      ["Practices", "1 live · ≈310, 1 off"],
      ["Appended system prompt", "≈3,120"],
    ]);
  });

  it("says a section has nothing in the planner's words", () => {
    const [, instructions] = sectionsOf({
      ...EXPLANATION,
      instructions: "left out (project.instructions: ignore)",
      instructionFiles: [],
    });
    expect(instructions?.empty).toBe(
      "Left out (project.instructions: ignore).",
    );
  });

  it("says a failed ask with nothing shown, and one beside the last answer", () => {
    expect([
      failedWords("no run `a1`", false),
      failedWords("no run `a1`", true),
    ]).toEqual([
      "Couldn't read the context: No run `a1`.",
      "Couldn't update: No run `a1`. This is the answer from before.",
    ]);
  });

  it("says a lessons file was cut at its cap", () => {
    const [, , , files] = sectionsOf({
      ...EXPLANATION,
      files: [
        {
          layer: "workflow",
          name: ".ork/lessons/review.md",
          tokens: 1500,
          cutFrom: 2100,
        },
      ],
    });
    expect(files?.pieces[0]?.why).toBe(
      "cut at the lessons cap a session loads; the whole file is about 2,100 tokens",
    );
  });

  it("makes the planner's words a sentence without changing them", () => {
    expect(sentence("shadowed by the workflow layer")).toBe(
      "Shadowed by the workflow layer.",
    );
    expect(sentence("It ends.")).toBe("It ends.");
    expect(sentence("project.skills: ignore")).toBe("project.skills: ignore.");
  });

  it("types a run's file from the project's root", () => {
    expect(fromRoot("/p/.ork/workflows/r.ork.yaml", "/p")).toBe(
      ".ork/workflows/r.ork.yaml",
    );
    expect(fromRoot("/elsewhere/r.ork.yaml", "/p")).toBe(
      "/elsewhere/r.ork.yaml",
    );
  });

  it("counts a text's lines", () => {
    expect([linesOf(""), linesOf("a\n"), linesOf("a\nb")]).toEqual([0, 1, 2]);
  });
});
