/**
 * @file Tests for `ork __onboard format` and `canon`: the brief names the top
 *   level and each node type's fields and stays under 24 KiB, an unknown type
 *   is refused with the known ones, and a file is rewritten through the
 *   serializer, left alone when it does not parse, and refused behind a link.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseWorkflow, serializeWorkflow } from "@krapht/ork-schema";
import { describe, expect, it } from "vitest";

import { canonFile, canonFiles } from "../src/onboard/verbs-canon.ts";
import {
  FORMAT_BRIEF_MAX_BYTES,
  formatBrief,
} from "../src/onboard/verbs-format.ts";

const tempDir = (): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), "ork-verbs-")));

const canonicalOf = (text: string): string => {
  const parsed = parseWorkflow(text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return serializeWorkflow(parsed.workflow);
};

const textOf = (types: string[] = []): string => {
  const brief = formatBrief(types);
  return brief.ok ? brief.text : brief.error;
};

describe("format", () => {
  it("prints the top level and every node type, under 24 KiB", () => {
    const brief = formatBrief();
    expect(brief.ok).toBe(true);
    const text = textOf();
    expect(Buffer.byteLength(text)).toBeLessThan(FORMAT_BRIEF_MAX_BYTES);
    expect(text).toMatch(/^ {2}schemaVersion\*: 1/mu);
    expect(text).toMatch(/^ {2}limits: object/mu);
    expect(text).toMatch(/^ {4}budgetUsd: number/mu);
    expect(text).toMatch(/^agent\.worker$/mu);
    expect(text).toMatch(/^human\.gate$/mu);
  });

  it("prints only the named types after the top level", () => {
    const text = textOf(["tool.shell"]);
    expect(text).toMatch(/^tool\.shell$/mu);
    expect(text).toMatch(/^ {2}script: string/mu);
    expect(text).not.toMatch(/^agent\.worker$/mu);
  });

  it("refuses an unknown type, naming the known ones", () => {
    const brief = formatBrief(["tool.nope"]);
    expect(brief).toMatchObject({ ok: false });
    expect(textOf(["tool.nope"])).toContain("Known: agent.leader");
  });
});

const WORKFLOW = `schemaVersion: 1
name: ci
nodes:
  build:
    prompt: Build it.
    type: agent.worker
`;

const write = (root: string, file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
};

describe("canon", () => {
  it("rewrites a file through the serializer, then finds it canonical", () => {
    const root = tempDir();
    write(root, "a.ork.yaml", WORKFLOW);
    expect(canonFile(root, "a.ork.yaml")).toEqual({
      file: "a.ork.yaml",
      status: "rewrote",
    });
    const text = readFileSync(path.join(root, "a.ork.yaml"), "utf8");
    expect(canonicalOf(text)).toBe(text);
    expect(canonFile(root, "a.ork.yaml").status).toBe("canonical");
  });

  it("leaves a file that does not parse as it was and still does the rest", () => {
    const root = tempDir();
    write(root, "bad.ork.yaml", "schemaVersion: 1\nname: Bad Name\n");
    write(root, "good.ork.yaml", WORKFLOW);
    const results = canonFiles(root, ["bad.ork.yaml", "good.ork.yaml"]);
    expect(results.map(result => result.status)).toEqual(["failed", "rewrote"]);
    expect(readFileSync(path.join(root, "bad.ork.yaml"), "utf8")).toBe(
      "schemaVersion: 1\nname: Bad Name\n",
    );
  });

  it("refuses a link and a file outside the folder", () => {
    const root = tempDir();
    const outside = tempDir();
    write(outside, "x.ork.yaml", WORKFLOW);
    symlinkSync(
      path.join(outside, "x.ork.yaml"),
      path.join(root, "x.ork.yaml"),
    );
    expect(canonFile(root, "x.ork.yaml").status).toBe("failed");
    expect(canonFile(root, path.join(outside, "x.ork.yaml")).status).toBe(
      "failed",
    );
    expect(readFileSync(path.join(outside, "x.ork.yaml"), "utf8")).toBe(
      WORKFLOW,
    );
  });
});
