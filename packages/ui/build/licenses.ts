/**
 * @file A Vite plugin that writes `THIRD_PARTY_LICENSES.txt` into the UI's
 *   build: every npm package the bundle actually contains (its modules and its
 *   files, such as the fonts), with its version and license text. The CLI ships
 *   the built UI, so it ships this list with it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

type Manifest = { name: string; version: string; license?: string };

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

/** The folder of the npm package that holds `file`, or null for Ork's own. */
export const packageDir = (file: string): string | null => {
  const clean = file.replace(/^\0/u, "").split("?")[0] ?? "";
  const at = clean.lastIndexOf(NODE_MODULES);
  if (at === -1) return null;
  const rest = clean.slice(at + NODE_MODULES.length).split(path.sep);
  const depth = rest[0]?.startsWith("@") === true ? 2 : 1;
  return path.join(
    clean.slice(0, at + NODE_MODULES.length),
    ...rest.slice(0, depth),
  );
};

const licenseText = (dir: string, manifest: Manifest): string => {
  const file = readdirSync(dir).find(name =>
    /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/iu.test(name),
  );
  return file === undefined
    ? `License: ${manifest.license ?? "see the package"}`
    : readFileSync(path.join(dir, file), "utf8").trim();
};

/** The license list for the packages in `dirs`, sorted by name. */
export const renderLicenses = (dirs: Iterable<string>): string => {
  const entries = [...new Set(dirs)]
    .filter(dir => existsSync(path.join(dir, "package.json")))
    .map(dir => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an installed package's manifest
      const manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as Manifest;
      return { manifest, text: licenseText(dir, manifest) };
    })
    .toSorted((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const sections = entries.map(
    ({ manifest, text }) =>
      `${manifest.name} ${manifest.version} (${manifest.license ?? "unknown"})\n\n${text}`,
  );
  return `Third-party software in Ork's UI\n\n${sections.join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
};

export const licenses = (): Plugin => ({
  name: "ork-licenses",
  apply: "build",
  generateBundle(_options, bundle) {
    const dirs: string[] = [];
    for (const item of Object.values(bundle)) {
      const sources =
        item.type === "chunk"
          ? Object.keys(item.modules)
          : item.originalFileNames;
      for (const source of sources) {
        const dir = packageDir(source);
        if (dir !== null) dirs.push(dir);
      }
    }
    this.emitFile({
      type: "asset",
      fileName: "THIRD_PARTY_LICENSES.txt",
      source: renderLicenses(dirs),
    });
  },
});
