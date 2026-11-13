/**
 * @file Tests for masking the values of the user's secret variables: in any
 *   form JSON writes them, line by line, in a JSON document's values, without
 *   masking short words, and a run's scrubber built from variable names.
 */

import { describe, expect, it } from "vitest";

import { envValuesOf, readEnv, runScrubber, scrubberOf } from "../src/index.ts";

describe("scrubberOf", () => {
  it("leaves short values alone, or every `1` would be masked", () => {
    expect(scrubberOf(["1", "true"])("1 true")).toBe("1 true");
    expect(scrubberOf(["abcdefgh"])("xabcdefghx")).toBe("x[masked]x");
  });

  it.each([
    ["Go, which escapes & < >", "p&w<d>-long", String.raw`p&w<d>-long`],
    [
      "PHP, which escapes / and non-ASCII",
      "pä/ss/word",
      String.raw`pä\/ss\/word`,
    ],
    ["PHP in another case", "pä/ss/word", String.raw`pä\/ss\/word`],
    [
      "Python, which escapes non-ASCII",
      "pässwörd-long",
      String.raw`pässwörd-long`,
    ],
    [
      "a quote and a backslash",
      String.raw`pa"ss\word`,
      String.raw`pa\"ss\\word`,
    ],
    ["an emoji, as two escapes", "tok😀en-long", String.raw`tok😀en-long`],
  ])("is masked as %s writes it", (_name, value, printed) => {
    expect(scrubberOf([value])(`before ${printed} after`)).toBe(
      "before [masked] after",
    );
  });

  it("is not slow on a value built to be", () => {
    const repeated = `${"a".repeat(4095)}b`;
    const slashes = `${"\\".repeat(36)}X`;
    const started = performance.now();
    scrubberOf([repeated])("a".repeat(4 * 1024 * 1024));
    scrubberOf([slashes])(`${"\\".repeat(72)}Y`);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("is masked line by line when a program reshapes it", () => {
    const pem = "-----BEGIN KEY-----\nabcdefgh12345678\n-----END KEY-----";
    const scrub = scrubberOf([pem]);
    expect(scrub(pem.replaceAll("\n", " "))).toBe("[masked] [masked] [masked]");
    expect(scrub(pem.replaceAll("\n", "\r\n"))).toBe(
      "[masked]\r\n[masked]\r\n[masked]",
    );
    expect(scrub("got abcdefgh12345678 here")).toBe("got [masked] here");
  });

  it("is masked when JSON is inside JSON", () => {
    const value = 'pa"ss\nword-long';
    const twice = JSON.stringify(JSON.stringify({ v: value }));
    const scrub = scrubberOf([value]);
    expect(scrub(twice)).not.toContain("word-long");
  });

  it("leaves no tail when two secrets overlap", () => {
    const scrub = scrubberOf(["abcdefgh12345678", "12345678zzzzzzzz"]);
    expect(scrub("abcdefgh12345678zzzzzzzz!")).toBe("[masked]!");
  });

  it("does not mask spaces for a value that is only spaces", () => {
    expect(scrubberOf(["        "])("a        b")).toBe("a        b");
  });

  it("is masked when printed without its stray whitespace", () => {
    expect(scrubberOf(["s3cret-value\r"])("got s3cret-value.")).toBe(
      "got [masked].",
    );
  });

  it("treats a value's special characters as text", () => {
    const scrub = scrubberOf(["a.b*c+d(e)[f]"]);
    expect(scrub("axbcccd")).toBe("axbcccd");
    expect(scrub("a.b*c+d(e)[f]")).toBe("[masked]");
  });
});

describe("a run's scrubber", () => {
  const environ = { MY_TOKEN: "s3cret-value-123", EMPTY: "" };

  it("reads only the environment's own variables", () => {
    expect(readEnv(environ, "MY_TOKEN")).toBe("s3cret-value-123");
    expect(readEnv(environ, "toString")).toBeUndefined();
  });

  it("masks the values of the names given that are set", () => {
    expect(envValuesOf(["MY_TOKEN", "UNSET", "EMPTY"], environ)).toEqual([
      "s3cret-value-123",
      "",
    ]);
    expect(
      runScrubber(["MY_TOKEN", "UNSET"], environ)("got s3cret-value-123"),
    ).toBe("got [masked]");
    expect(runScrubber([], environ)("got s3cret-value-123")).toBe(
      "got s3cret-value-123",
    );
  });
});
