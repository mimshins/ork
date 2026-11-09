/** @file Tests closing a shipped RFC: its status, move, index row and links. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { closeInIndex, closeRfc, markImplemented } from "../close.ts";

const FILE = "RFC-013-for-each.md";
const ROW = `| [013](./active/${FILE})     | Running a node | Accepted    |`;
const INDEX = `# RFCs\n\n${ROW}\n`;
const RFC = "# RFC-013\n\n- **Status:** Accepted (2026-11-07)\n\nBody\n";
const SPEC = `See [it](../rfcs/active/${FILE}).\n`;

const made: string[] = [];

/** A repository holding one active RFC, its index, and a spec linking to it. */
const repository = (rfc = RFC, index = INDEX): string => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-rfc-close-"));
  made.push(root);
  mkdirSync(path.join(root, "rfcs", "active"), { recursive: true });
  mkdirSync(path.join(root, "rfcs", "archived"));
  mkdirSync(path.join(root, "specs"));
  writeFileSync(path.join(root, "rfcs", "active", FILE), rfc);
  writeFileSync(path.join(root, "rfcs", "README.md"), index);
  writeFileSync(path.join(root, "specs", "a.md"), SPEC);
  return root;
};

/** The sample index after closing its RFC; empty if that was refused. */
const closedIndex = (): string => closeInIndex(INDEX, FILE) ?? "";

/** The text of `parts` under `root`. */
const read = (root: string, ...parts: string[]): string =>
  readFileSync(path.join(root, ...parts), "utf8");

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("closing an RFC", () => {
  it("sets the status and leaves the rest", () => {
    expect(markImplemented(RFC)).toBe(
      "# RFC-013\n\n- **Status:** Implemented\n\nBody\n",
    );
  });

  it("refuses an RFC that is not Accepted", () => {
    expect(markImplemented("- **Status:** Draft\n")).toBeUndefined();
  });

  it("repoints the index row and keeps its width", () => {
    const closed = closedIndex();
    expect(closed).toContain(`(./archived/${FILE})`);
    expect(closed).toContain("| Implemented |");
    expect(closed.split("\n")[2]).toHaveLength(ROW.length);
  });

  it("moves the file and updates the index", () => {
    const root = repository();
    expect(closeRfc(root, "RFC-013")).toBeUndefined();
    expect(existsSync(path.join(root, "rfcs", "active", FILE))).toBe(false);
    expect(read(root, "rfcs", "archived", FILE)).toContain("Implemented");
    expect(read(root, "rfcs", "README.md")).toContain("./archived/");
  });

  it("repoints links to it in other documents", () => {
    const root = repository();
    closeRfc(root, "RFC-013");
    expect(read(root, "specs", "a.md")).toBe(
      `See [it](../rfcs/archived/${FILE}).\n`,
    );
  });

  it("reports an RFC that is not active", () => {
    expect(closeRfc(repository(), "RFC-099")).toBe(
      "RFC-099 is not in rfcs/active/.",
    );
  });

  it("changes nothing when the index has no row", () => {
    const root = repository(RFC, "# RFCs\n");
    expect(closeRfc(root, "RFC-013")).toBe(
      `rfcs/README.md has no row for ${FILE}.`,
    );
    expect(read(root, "rfcs", "active", FILE)).toBe(RFC);
  });
});
