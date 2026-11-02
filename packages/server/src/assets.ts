/**
 * @file The built UI's files (`packages/ui/dist`, shipped as the CLI's
 *   `dist/ui`): `/` is its `index.html`, and `/assets/…` are its hashed files,
 *   cached for good. Only a file inside the folder, with a known type, is
 *   served; anything else is none.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The types the UI's build writes; anything else is not served. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export type Asset = {
  body: Buffer;
  type: string;
  /** A hashed file under `/assets/`, which never changes. */
  immutable: boolean;
};

/** Whether `dir` holds a built UI. */
export const hasUi = (dir: string): boolean => {
  try {
    return statSync(path.join(dir, "index.html")).isFile();
  } catch {
    return false;
  }
};

/** The file `pathname` names in the built UI `dir`, or null. */
export const readAsset = (dir: string, pathname: string): Asset | null => {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const root = path.resolve(dir);
  const file = path.resolve(root, decoded);
  const type = TYPES[path.extname(file)];
  if (type === undefined || !file.startsWith(`${root}${path.sep}`)) return null;
  try {
    if (!statSync(file).isFile()) return null;
    return {
      body: readFileSync(file),
      type,
      immutable: decoded.startsWith("assets/"),
    };
  } catch {
    return null;
  }
};
