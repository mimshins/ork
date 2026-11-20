/**
 * @file The user's own settings, `~/.ork/settings.yaml`: read if it exists, and
 *   reported rather than ignored when it can't be read, since it may hold a cap
 *   the user relies on.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  type Diagnostic,
  parseUserSettings,
  type UserSettings,
} from "@krapht/ork-schema";

import { error } from "../graph/diagnostics.ts";

/** Where the user's own settings live. */
export const USER_SETTINGS_FILE = path.join(".ork", "settings.yaml");

export type LoadedUserSettings = {
  settings?: UserSettings;
  diagnostics: Diagnostic[];
};

/**
 * Reads `~/.ork/settings.yaml`, if it exists. One that can't be read is
 * reported rather than ignored: it may hold a cap the user is relying on.
 */
export const loadUserSettings = (
  home: string = homedir(),
): LoadedUserSettings => {
  const file = path.join(home, USER_SETTINGS_FILE);
  if (!existsSync(file)) return { diagnostics: [] };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (failed) {
    const reason = failed instanceof Error ? failed.message : String(failed);
    return {
      diagnostics: [
        error("settings.read", `~/${USER_SETTINGS_FILE}: ${reason}`, []),
      ],
    };
  }
  // A file of only comments says nothing, as no file does.
  if (text.split("\n").every(line => /^\s*(?:#.*)?$/u.test(line))) {
    return { diagnostics: [] };
  }
  const parsed = parseUserSettings(text);
  if (parsed.ok) return { settings: parsed.settings, diagnostics: [] };
  return {
    diagnostics: parsed.diagnostics.map(d =>
      error(
        d.code,
        `~/${USER_SETTINGS_FILE}${d.line === undefined ? "" : `:${d.line}:${d.column ?? 1}`}: ${d.message}`,
        [],
      ),
    ),
  };
};
