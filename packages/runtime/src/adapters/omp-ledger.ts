/**
 * @file Ork's own count of what an `omp` session has spent (RFC-026). `omp`'s
 *   `--max-cost` counts the whole session, so a resumed leg's cap is what the
 *   session had spent before plus the node's `budgetUsd`, and a resumed leg
 *   reports the session's total as its cost (ADR-046). The count lives in one
 *   small file per session, `<home>/.ork/omp/spent/<session id>` (0600, in a
 *   0700 folder), holding a dollar figure. A missing or unreadable entry reads
 *   as 0.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** A session id that is safe as a file name: no separator, no leading dot. */
const SAFE_ID = /^[\w-][\w.-]*$/u;

const fileOf = (dir: string, id: string): string | undefined =>
  SAFE_ID.test(id) ? path.join(dir, id) : undefined;

/** What the ledger in `dir` says session `id` has spent, in dollars; 0 if none. */
export const sessionSpend = (dir: string, id: string): number => {
  const file = fileOf(dir, id);
  if (file === undefined) return 0;
  try {
    const spent = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(spent) && spent > 0 ? spent : 0;
  } catch {
    return 0;
  }
};

/** Adds `usd` to what the ledger in `dir` holds for session `id`. */
export const addSpend = (dir: string, id: string, usd: number): void => {
  const file = fileOf(dir, id);
  if (file === undefined || !Number.isFinite(usd) || usd <= 0) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, String(sessionSpend(dir, id) + usd), { mode: 0o600 });
};
