/**
 * @file Tests for which shell lines Ork refuses as reads (RFC-025): a pipeline
 *   that starts by reading files is refused with the `extract` call to make; a
 *   reader that filters another command's output, a write, and a quoted
 *   separator are not. The patterns OpenCode refuses name the same programs.
 */

import { describe, expect, it } from "vitest";

import {
  SHELL_READ_COMMANDS,
  shellReadReason,
} from "../src/tools/shell-reads.ts";

const refused = (line: string): boolean => shellReadReason(line) !== undefined;

describe("shellReadReason", () => {
  it("refuses a line whose pipeline starts by reading files", () => {
    expect(
      [
        "cat src/a.ts",
        "head -50 README.md",
        "sed -n 1,40p x.ts",
        "grep -rn foo src",
        "rg harness packages",
        "find . -name '*.ts'",
        "ls -R src",
        "git diff --stat",
        "git -C ../x log --oneline -5",
        "cd src && cat a.ts",
        "FOO=1 grep x y",
        "/usr/bin/cat a",
        "cat a.ts | grep foo",
      ].map(line => refused(line)),
    ).toEqual(Array.from({ length: 13 }, () => true));
  });

  it("leaves output filters, writes, quotes and other commands alone", () => {
    expect(
      [
        "pnpm test 2>&1 | tail -20",
        "sed -i s/a/b/ x.ts",
        "find . -name '*.tmp' -delete",
        "echo 'a | cat'",
        "ls -la",
        "git status",
        "git commit -m 'git diff'",
        "pnpm check",
      ].map(line => refused(line)),
    ).toEqual(Array.from({ length: 8 }, () => false));
  });

  it("names the extract call that does the same", () => {
    expect(shellReadReason("rg foo src")).toContain('"step":"search"');
    expect(shellReadReason("find . -name x")).toContain('"step":"files"');
    expect(shellReadReason("git show HEAD")).toContain('"op":"show"');
    expect(shellReadReason("tail -5 a.ts")).toContain('"step":"read"');
  });

  it("refuses every command OpenCode's patterns name", () => {
    expect(
      SHELL_READ_COMMANDS.filter(command => !refused(`${command} x`)),
    ).toEqual([]);
  });
});
