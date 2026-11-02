/**
 * @file `~/.ork/ui.json`: the running server's port, pid, token and start time
 *   (ADR-039). It is written with mode 0600 when the server starts, so a second
 *   `ork ui` finds and opens the running one, and removed when it stops. A
 *   record whose process is gone counts as none.
 */

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { processAlive } from "@krapht/ork-core";
import { z } from "zod";

const UiRecordSchema = z.object({
  port: z.int().min(1).max(65_535),
  pid: z.int().positive(),
  token: z.string().min(1),
  startedAt: z.string(),
});

export type UiRecord = z.infer<typeof UiRecordSchema>;

/** Where the record lives; `home` is `~` (tests pass a folder). */
export const uiFilePath = (home: string = homedir()): string =>
  path.join(home, ".ork", "ui.json");

/** The record, or `null` when there is none or it cannot be read. */
export const readUiFile = (file: string): UiRecord | null => {
  try {
    const parsed = UiRecordSchema.safeParse(
      JSON.parse(readFileSync(file, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Writes the record readable by the user only, replacing any other. */
export const writeUiFile = (file: string, record: UiRecord): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
};

/** Removes the record, if it is still the one of the server `pid`. */
export const removeUiFile = (file: string, pid: number): void => {
  if (readUiFile(file)?.pid === pid) rmSync(file, { force: true });
};

/** The record of a server that is still running, or `null`. */
export const runningServer = (file: string): UiRecord | null => {
  const record = readUiFile(file);
  return record !== null && processAlive(record.pid) ? record : null;
};
