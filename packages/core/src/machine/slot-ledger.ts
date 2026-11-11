/**
 * @file The machine-wide ledger of slots for heavy commands (a project's
 *   `heavy` rule): every run on the machine, in any project, shares a few slots
 *   (`ORK_HEAVY_SLOTS`, default 2), so several full checks at once don't thrash
 *   the machine. The lease ledger's mechanism: a slot is a record file made
 *   with a hard link, which is atomic and fails when it exists. A waiter queues
 *   a ticket first, so slots go first come, first served. A record or ticket
 *   whose process is gone is swept, and its slot taken over. Records hold run
 *   ids, node ids and pids only.
 */

import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Who takes a slot: the run's node, in the process that runs it. */
export type SlotHolder = { run: string; node: string; pid: number };

/** A slot's record, or a waiter's ticket. */
export type HeldSlot = SlotHolder & { id: string };

export type TakeOptions = {
  signal: AbortSignal;
  /** Called once, when the slot is not free at once, with who holds them. */
  onWait?: (holders: HeldSlot[]) => void;
};

/**
 * The slots one machine shares. `take` waits for a slot, first come, and
 * resolves with its release, or `null` when `signal` aborted the wait.
 */
export type SlotLedger = {
  take: (
    holder: SlotHolder,
    options: TakeOptions,
  ) => Promise<(() => void) | null>;
  /** Who holds a slot now. */
  holders: () => HeldSlot[];
  /** Drops the records and tickets of processes that are gone; returns them. */
  sweep: () => HeldSlot[];
};

export const DEFAULT_HEAVY_SLOTS = 2;

/** `ORK_HEAVY_SLOTS` as a count; anything but a positive integer is the default. */
export const heavySlots = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): number => {
  const count = Number(env["ORK_HEAVY_SLOTS"]);
  return Number.isInteger(count) && count > 0 ? count : DEFAULT_HEAVY_SLOTS;
};

const codeOf = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

const alive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, under another user.
    return codeOf(error) === "EPERM";
  }
};

const read = (file: string): HeldSlot | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("id" in value && "run" in value && "node" in value && "pid" in value)
    ) {
      return undefined;
    }
    const { id, run, node, pid } = value;
    return typeof id === "string" &&
      typeof run === "string" &&
      typeof node === "string" &&
      typeof pid === "number"
      ? { id, run, node, pid }
      : undefined;
  } catch {
    return undefined;
  }
};

const listed = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith(".json"))
      .toSorted();
  } catch {
    return [];
  }
};

/** Written whole (a rename), so no reader sees half a record. */
const writeWhole = (file: string, record: HeldSlot): void => {
  const draft = `${file}.${record.id}.tmp`;
  writeFileSync(draft, JSON.stringify(record), { mode: 0o600 });
  renameSync(draft, file);
};

/** Deletes a record if it is still `id`'s. */
const dropIf = (file: string, id: string): void => {
  // shortcut: compare-then-delete is not atomic across processes, as in the
  // lease ledger; a sweep racing a fresh take may drop it. Upgrade to a lock
  // if that shows.
  if (read(file)?.id === id) rmSync(file, { force: true });
};

let tickets = 0;

/** A ticket's name: sorted by when it was queued. */
const ticketName = (id: string): string =>
  `${String(Date.now()).padStart(15, "0")}-${String(process.pid).padStart(8, "0")}-${String((tickets += 1)).padStart(6, "0")}-${id}.json`;

/** The ledger in `dir`, with `slots` slots. */
export const fileSlotLedger = (options: {
  dir: string;
  slots: number;
  /** How often a waiter looks again. */
  pollMs?: number;
}): SlotLedger => {
  const { dir, slots } = options;
  const queue = path.join(dir, "queue");
  const slotFile = (index: number): string =>
    path.join(dir, `slot-${String(index)}.json`);

  const records = (): { file: string; held: HeldSlot | undefined }[] =>
    Array.from({ length: slots }, (_, index) => {
      const file = slotFile(index);
      return { file, held: read(file) };
    });

  const holders = (): HeldSlot[] =>
    records().flatMap(({ held }) => (held === undefined ? [] : [held]));

  const sweep = (): HeldSlot[] => {
    const gone: HeldSlot[] = [];
    for (const file of [
      ...records().map(record => record.file),
      ...listed(queue).map(name => path.join(queue, name)),
    ]) {
      const held = read(file);
      if (held === undefined || alive(held.pid)) continue;
      dropIf(file, held.id);
      gone.push(held);
    }
    return gone;
  };

  /** Links `draft` into a free slot; true when it got one. */
  const tryTake = (draft: string): boolean => {
    for (const { file, held } of records()) {
      if (held !== undefined) continue;
      try {
        linkSync(draft, file);
        return true;
      } catch (error) {
        if (codeOf(error) !== "EEXIST") throw error;
      }
    }
    return false;
  };

  const take: SlotLedger["take"] = async (holder, { signal, onWait }) => {
    mkdirSync(queue, { recursive: true, mode: 0o700 });
    const record: HeldSlot = { id: randomUUID(), ...holder };
    const ticket = path.join(queue, ticketName(record.id));
    writeWhole(ticket, record);
    let told = false;
    try {
      for (;;) {
        if (signal.aborted) return null;
        sweep();
        const free = records().filter(({ held }) => held === undefined).length;
        const ahead = listed(queue).indexOf(path.basename(ticket));
        // A ticket is a hard-link source too: its record goes in whole.
        if (ahead < free && tryTake(ticket)) {
          const release = (): void => {
            for (const { file, held } of records()) {
              if (held?.id === record.id) dropIf(file, record.id);
            }
          };
          return release;
        }
        if (!told) {
          told = true;
          onWait?.(holders());
        }
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- polling the ledger
          await delay(options.pollMs ?? 500, undefined, { signal });
        } catch {
          return null;
        }
      }
    } finally {
      rmSync(ticket, { force: true });
    }
  };

  return { take, holders, sweep };
};

/** The machine's ledger: `~/.ork/slots`, `ORK_HEAVY_SLOTS` slots. */
export const machineSlotLedger = (
  options: {
    home?: string;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): SlotLedger =>
  fileSlotLedger({
    dir: path.join(options.home ?? homedir(), ".ork", "slots"),
    slots: heavySlots(options.env),
  });
