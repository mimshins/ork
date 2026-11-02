/**
 * @file Tests for the build's license list: a bundled file is traced to its npm
 *   package (scoped or not, pnpm's layout included), Ork's own files are left
 *   out, and each package's license text is written once, sorted.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { packageDir, renderLicenses } from "../build/licenses.ts";

const store = path.join(path.sep, "w", "node_modules", ".pnpm");

/** An installed package with a manifest and, maybe, a LICENSE file. */
const installed = (name: string, license?: string): string => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "ork-lic-")), name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", license: "MIT" }),
  );
  if (license !== undefined) writeFileSync(path.join(dir, "LICENSE"), license);
  return dir;
};

describe("the license list", () => {
  it("traces a bundled file to its package", () => {
    const scoped = path.join(store, "@base-ui+react@1.9.0", "node_modules");
    expect(
      packageDir(path.join(scoped, "@base-ui", "react", "esm", "x.js")),
    ).toBe(path.join(scoped, "@base-ui", "react"));
    const plain = path.join(store, "react@19.3.1", "node_modules");
    expect(
      packageDir(`\0${path.join(plain, "react", "index.js")}?commonjs`),
    ).toBe(path.join(plain, "react"));
    expect(
      packageDir(
        path.join(path.sep, "w", "packages", "server", "src", "contract.ts"),
      ),
    ).toBeNull();
  });

  it("writes each package's license once, sorted by name", () => {
    const zod = installed("zod", "MIT License\nCopyright Colin");
    const react = installed("react");
    const text = renderLicenses([zod, react, zod]);
    expect(text.indexOf("react 1.0.0 (MIT)")).toBeLessThan(
      text.indexOf("zod 1.0.0 (MIT)"),
    );
    expect(text).toContain("Copyright Colin");
    expect(text).toContain("License: MIT");
    expect(text.split("zod 1.0.0")).toHaveLength(2);
  });
});
