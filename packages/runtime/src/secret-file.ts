/**
 * @file A session's private folder for files that hold a secret, such as a
 *   config carrying Ork's bearer token (RFC-014): a 0700 folder outside the
 *   checkout, under the system's temporary folder, named after the process that
 *   made it, with each file written at mode 0600. The session removes it when
 *   it ends; a folder whose process is gone (a crash) is removed when the next
 *   one is made. Nothing here logs what it writes.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { alive } from "./lease-ledger.ts";

/** Where sessions' private folders live unless a caller names another place. */
export const secretRoot = (): string => path.join(tmpdir(), "ork-sessions");

export type SecretFolder = {
  dir: string;
  /** Writes `name` in the folder at mode 0600; returns its path. */
  write: (name: string, content: string) => string;
  remove: () => void;
};

/** Removes the folders under `root` whose process is gone; returns them. */
export const sweepSecretFolders = (root: string): string[] => {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names.flatMap(name => {
    const pid = Number(name.split("-")[0]);
    if (!Number.isInteger(pid) || alive(pid)) return [];
    const dir = path.join(root, name);
    rmSync(dir, { recursive: true, force: true });
    return [dir];
  });
};

/** A new private folder under `root`, after sweeping the stale ones. */
export const makeSecretFolder = (root = secretRoot()): SecretFolder => {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  sweepSecretFolders(root);
  // mkdtemp makes the folder 0700.
  const dir = mkdtempSync(path.join(root, `${String(process.pid)}-`));
  return {
    dir,
    write: (name, content) => {
      const file = path.join(dir, name);
      writeFileSync(file, content, { mode: 0o600 });
      return file;
    },
    remove: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
