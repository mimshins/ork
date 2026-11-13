/**
 * @file Tests `kit.ts`'s dispatch: the usage it prints for an unknown or
 *   missing subcommand (it carries the note that a wrapper around a stand-in
 *   must stream stdin through, since Ork's driver keeps stdin open until the
 *   first result), and that each subcommand reaches its own module, shown by
 *   the module's refusal of a path or name that is not a kit's. Every refusal
 *   happens before anything is created, changed or ended.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const KIT = fileURLToPath(new URL("../kit.ts", import.meta.url));

const kit = (...args: string[]) => {
  const done = spawnSync(process.execPath, [KIT, ...args], {
    encoding: "utf8",
  });
  return { status: done.status, stderr: done.stderr, stdout: done.stdout };
};

describe("kit.ts usage", () => {
  it("tells a wrapper to stream stdin through", () => {
    const done = kit();
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("Usage: kit.ts setup");
    expect(done.stderr).toContain("must stream stdin through");
  });

  it.each([["bogus"], ["constructor"], ["toString"]])(
    "prints the usage for the unknown name %s",
    name => {
      const done = kit(name);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain("Usage: kit.ts setup");
      expect(done.stdout).toBe("");
    },
  );

  it.each([["setup"], ["setup", "a.tgz"], ["commit"], ["stop"], ["sweep"]])(
    "prints the usage for `%s` without its arguments",
    (...args) => {
      const done = kit(...args);
      expect(done.status).toBe(1);
      expect(done.stderr).toContain("Usage: kit.ts setup");
    },
  );
});

describe("kit.ts subcommands", () => {
  it("sends `setup` to its module, which refuses a name that is not plain", () => {
    const done = kit("setup", "a.tgz", "not a plain name");
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("is not a plain name");
    expect(done.stderr).not.toContain("Usage:");
  });

  it.each([["commit"], ["stop"], ["sweep"]])(
    "sends `%s` to its module, which refuses a path outside the temp folder",
    name => {
      const done = kit(name, "/");
      expect(done.status).toBe(1);
      expect(done.stderr).toContain("is not inside the temp folder");
      expect(done.stderr).not.toContain("Usage:");
    },
  );
});
