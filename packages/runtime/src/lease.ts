/**
 * @file The `lease` kind of `McpWiring` (RFC-014): Command Code reads MCP
 *   servers from a per-folder local scope (`~/.commandcode/projects/<slug>/`),
 *   so a session gets Ork's endpoint through an `ork` entry added there with
 *   `cmd mcp add --scope local` and removed with `cmd mcp remove` after it.
 *   Because the entry is per folder, a checkout holds one session at a time: a
 *   record in the ledger (`lease-ledger.ts`) is the lock, and a second session
 *   waits for it, and says so.
 */

import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { MASK, maskSecrets } from "@krapht/ork-core";

import type { McpWiring, OrkEndpoint, WireHooks } from "./adapter.ts";
import {
  alive,
  cleanStaleLeases,
  codeOf,
  dropIfCorrupt,
  dropRecord,
  type Env,
  type Lease,
  LEASE_ENTRY,
  leaseLedger,
  type LeaseOptions,
  type LeaseSweep,
  readLease,
  removeEntry,
  runCmd,
} from "./lease-ledger.ts";

export { cleanStaleLeases, LEASE_ENTRY, leaseLedger };
export type { LeaseOptions, LeaseSweep };

/**
 * Command Code's folder name for a checkout, as measured on 1.88.5: its real
 * path with every character but letters and digits made `-`, the leading one
 * dropped (`/private/tmp/a b` -> `private-tmp-a-b`). Leases key on it, so two
 * folders Command Code would share also share one lease.
 */
const slugOf = (folder: string): string =>
  realpathSync(folder)
    .replaceAll(/[^a-zA-Z0-9]/gu, "-")
    .replace(/^-+/u, "");

const entryFileOf = (env: Env, slug: string): string =>
  path.join(
    env["HOME"] ?? homedir(),
    ".commandcode",
    "projects",
    slug,
    "mcp.json",
  );

/** Takes the record for `slug`, or returns the live lease that holds it. */
const tryTake = (file: string, lease: Lease): Lease | undefined => {
  const draft = `${file}.${lease.id}`;
  writeFileSync(draft, JSON.stringify(lease), { mode: 0o600 });
  try {
    // A hard link is atomic and fails when the record exists.
    linkSync(draft, file);
    return undefined;
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;
    const holder = readLease(file);
    if (holder !== undefined) return holder;
    dropIfCorrupt(file);
    // Gone or corrupt: a holder with no process, so the caller tries again.
    return { ...lease, pid: 0 };
  } finally {
    rmSync(draft, { force: true });
  }
};

const masked = (text: string, endpoint: OrkEndpoint): string =>
  maskSecrets(text.replaceAll(endpoint.token, MASK));

/**
 * The lease's options: those given, else the runner's program, environment and
 * the project's runs folder (the ledger lives there, where `ork doctor`
 * looks).
 */
const optionsOf = (
  given: Partial<LeaseOptions>,
  hooks: WireHooks,
): LeaseOptions => {
  const ledger =
    given.ledger ??
    (hooks.runs === undefined ? undefined : leaseLedger(hooks.runs));
  if (ledger === undefined) {
    throw new Error(
      "a Command Code session needs the project's runs folder for its lease",
    );
  }
  const env = given.env ?? hooks.env;
  return {
    ...given,
    bin: given.bin ?? hooks.bin ?? "cmd",
    ledger,
    ...(env === undefined ? {} : { env }),
  };
};

/**
 * Ork's endpoint for a Command Code session, through an `ork` entry in the
 * checkout's local scope, held for the session. A second session in the same
 * checkout waits for the first, and says so.
 */
export const leaseWiring = (given: Partial<LeaseOptions>): McpWiring => ({
  kind: "lease",
  wire: async (spec, endpoint, hooks) => {
    const options = optionsOf(given, hooks);
    const env = options.env ?? process.env;
    const slug = slugOf(spec.cwd);
    const file = path.join(options.ledger, `${slug}.json`);
    const lease: Lease = {
      id: randomUUID(),
      folder: realpathSync(spec.cwd),
      pid: process.pid,
      entry: entryFileOf(env, slug),
    };
    const fail = (message: string): never => {
      dropRecord(file, lease);
      throw new Error(masked(message, endpoint));
    };
    mkdirSync(options.ledger, { recursive: true, mode: 0o700 });
    await cleanStaleLeases(options);
    let told = false;
    for (;;) {
      const holder = tryTake(file, lease);
      if (holder === undefined) break;
      if (alive(holder.pid)) {
        if (!told) {
          hooks.waiting(
            `waiting for ${lease.folder}: Command Code runs one session per checkout`,
          );
          told = true;
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling the lock
        await delay(options.pollMs ?? 1000, undefined, {
          signal: hooks.signal,
        });
      } else {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one `cmd` at a time
        const { failed } = await cleanStaleLeases(options);
        if (failed.includes(holder.folder)) {
          fail(
            `could not remove the \`${LEASE_ENTRY}\` MCP entry a stopped session left in ${holder.folder}; run \`ork doctor\``,
          );
        }
      }
    }
    // Never replace an `ork` entry the user made themselves.
    const existing = await runCmd(
      options,
      ["mcp", "get", LEASE_ENTRY],
      lease.folder,
    );
    if (existing.ok && /Scope:\s+local/u.test(existing.out)) {
      fail(
        `Command Code already has an \`${LEASE_ENTRY}\` MCP entry for ${lease.folder}; remove it with \`cmd mcp remove --scope local ${LEASE_ENTRY}\` there`,
      );
    }
    const added = await runCmd(
      options,
      [
        "mcp",
        "add",
        "--transport",
        "http",
        "--scope",
        "local",
        LEASE_ENTRY,
        endpoint.url,
        "--header",
        `Authorization: Bearer ${endpoint.token}`,
      ],
      lease.folder,
    );
    if (!added.ok) fail(`cmd mcp add failed: ${added.out}`);
    return {
      args: [],
      env: {},
      release: async () => {
        if (await removeEntry(options, lease)) {
          dropRecord(file, lease);
          return;
        }
        // Left for the next run or `ork doctor` to remove; written whole, so
        // no reader sees half a record.
        const draft = `${file}.${lease.id}`;
        writeFileSync(draft, JSON.stringify({ ...lease, pid: 0 }), {
          mode: 0o600,
        });
        renameSync(draft, file);
      },
    };
  },
});
