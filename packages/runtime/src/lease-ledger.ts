/**
 * @file The ledger of Command Code leases (RFC-014, `lease.ts`): one record per
 *   checkout in a folder of the project's runs folder, naming the session's
 *   process and its `ork` entry, and the sweep that removes the entry of every
 *   record whose process is gone (the next session's start, and `ork doctor`).
 *   Only the `ork` entry is touched; the user's other entries stay as they
 *   were.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

export type Env = Readonly<Record<string, string | undefined>>;

export type LeaseOptions = {
  /** The `cmd` program; tests pass a fake. */
  bin: string;
  /** The folder of lease records: `leaseLedger(<the project's runs folder>)`. */
  ledger: string;
  /** The user's environment; `HOME` locates Command Code's own config. */
  env?: Env;
  /** How often a waiting session looks again. */
  pollMs?: number;
};

/** One session's hold on a checkout. `pid` 0: its entry could not be removed. */
const LeaseSchema = z.object({
  id: z.string(),
  folder: z.string(),
  pid: z.number(),
  entry: z.string(),
});
export type Lease = z.infer<typeof LeaseSchema>;

/** A local-scope file: only `mcpServers` is read; the rest is kept as is. */
const LocalScopeSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

export const codeOf = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

/** The entry's name in Command Code's local scope. */
export const LEASE_ENTRY = "ork";

const CMD_TIMEOUT_MS = 30_000;

/** Where a project's lease records live, inside its runs folder. */
export const leaseLedger = (runsDir: string): string =>
  path.join(runsDir, ".leases");

export const alive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, under another user.
    return codeOf(error) === "EPERM";
  }
};

export const readLease = (file: string): Lease | undefined => {
  try {
    return LeaseSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
};

export const runCmd = (
  options: LeaseOptions,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; out: string }> =>
  new Promise(resolve => {
    execFile(
      options.bin,
      args,
      {
        cwd,
        env: { ...(options.env ?? process.env) },
        encoding: "utf8",
        timeout: CMD_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        resolve({ ok: error === null, out: `${stdout}${stderr}`.trim() });
      },
    );
  });

/** Drops the `ork` entry from a local-scope file whose folder is gone. */
const dropFromFile = (entry: string): boolean => {
  if (!existsSync(entry)) return true;
  try {
    const config = LocalScopeSchema.parse(
      JSON.parse(readFileSync(entry, "utf8")),
    );
    const { [LEASE_ENTRY]: ours, ...others } = config.mcpServers ?? {};
    if (ours === undefined) return true;
    const kept = { ...config, mcpServers: others };
    writeFileSync(entry, `${JSON.stringify(kept, null, 2)}\n`, {
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
};

/** Removes a lease's `ork` entry; true once it is gone. */
export const removeEntry = async (
  options: LeaseOptions,
  lease: Lease,
): Promise<boolean> => {
  // A checkout removed since: `cmd` can't run there, so edit its file.
  if (!existsSync(lease.folder)) return dropFromFile(lease.entry);
  const removed = await runCmd(
    options,
    ["mcp", "remove", "--scope", "local", LEASE_ENTRY],
    lease.folder,
  );
  return removed.ok || removed.out.includes("not found");
};

/** Deletes a record if it is still `lease`'s, not a newer one's. */
export const dropRecord = (file: string, lease: Lease): void => {
  // shortcut: compare-then-delete is not atomic across processes; two runs
  // cleaning the same stale record at once could drop a fresh one. Upgrade to
  // a lock on the ledger if runs sharing one checkout become common.
  if (readLease(file)?.id === lease.id) rmSync(file, { force: true });
};

/**
 * Deletes a record that exists but can't be read: records are written whole (a
 * link, a rename), so one that does not parse is corrupt, and stale.
 */
export const dropIfCorrupt = (file: string): void => {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  try {
    LeaseSchema.parse(JSON.parse(text));
  } catch {
    rmSync(file, { force: true });
  }
};

export type LeaseSweep = {
  /** Checkouts whose stale `ork` entry was removed. */
  cleaned: string[];
  /** Checkouts whose stale `ork` entry could not be removed. */
  failed: string[];
};

/**
 * Removes the `ork` entry of every lease whose session is gone (a crash, or a
 * removal that failed), and its record. Live leases are left alone.
 */
export const cleanStaleLeases = async (
  options: LeaseOptions,
): Promise<LeaseSweep> => {
  const sweep: LeaseSweep = { cleaned: [], failed: [] };
  if (!existsSync(options.ledger)) return sweep;
  for (const name of readdirSync(options.ledger)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(options.ledger, name);
    const lease = readLease(file);
    if (lease === undefined) dropIfCorrupt(file);
    if (lease === undefined || alive(lease.pid)) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- one `cmd` at a time
    if (await removeEntry(options, lease)) {
      dropRecord(file, lease);
      sweep.cleaned.push(lease.folder);
    } else {
      sweep.failed.push(lease.folder);
    }
  }
  return sweep;
};
