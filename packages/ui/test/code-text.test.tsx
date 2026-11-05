/** @file Words that name values: backticks show as inline code. */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  codeParts,
  CodeText,
  plainWords,
} from "../src/components/code-text.tsx";

const codeOf = (text: string): string[] =>
  codeParts(text)
    .filter(part => part.code)
    .map(part => part.text);

describe("code text", () => {
  it.each([
    ["more backticks hold one", "see `` a`b `` here", ["a`b"]],
    ["a pair beside a longer one", "``foo`` and ```bar```", ["foo", "bar"]],
    ["a lone pair of them beside real ones", "`x` and `` and `y`", ["x", "y"]],
    // What `markValue` writes, which schema can't be imported to check here.
    ["a backtick at the start", "is `` `a `` ok", ["`a"]],
    ["a backtick at the end", "is `` a` `` ok", ["a`"]],
    ["only a backtick", "is `` ` `` ok", ["`"]],
    ["a space on one side stays", "is ` a` ok", [" a"]],
    ["a shorter closing run doesn't close it", "``a` b", []],
    ["space alone isn't a value", "` `", []],
    ["a line break ends a run", "`a\nb`", []],
  ])("pairs them as Markdown does: %s", (_, text, code) => {
    expect(codeOf(text)).toEqual(code);
  });

  it("shows what's between backticks as code", () => {
    expect(
      renderToStaticMarkup(<CodeText text="`human.gate` is broken!" />),
    ).toBe("<code>human.gate</code> is broken!");
  });

  it("keeps several values and the words between them", () => {
    expect(codeParts("`a -> b`: `c` or `d`")).toEqual([
      { code: true, text: "a -> b" },
      { code: false, text: ": " },
      { code: true, text: "c" },
      { code: false, text: " or " },
      { code: true, text: "d" },
    ]);
  });

  it.each([
    ["no marks", "plain words"],
    ["a lone backtick", "a ` alone"],
    ["an empty pair", "an `` empty pair"],
  ])("leaves %s as they are", (_name, text) => {
    expect(codeParts(text)).toEqual([{ code: false, text }]);
  });

  it("escapes what it shows", () => {
    expect(renderToStaticMarkup(<CodeText text="`<script>`" />)).toBe(
      "<code>&lt;script&gt;</code>",
    );
  });

  it("gives the words without the marks, for a screen reader", () => {
    expect(plainWords("`human.gate` is broken!")).toBe("human.gate is broken!");
  });
});
