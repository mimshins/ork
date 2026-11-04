/**
 * @file What `ork watch` does (RFC-011), with its look and its start passed in:
 *   each accepted trigger looks when it's due, apart from the others, so a
 *   stuck check can't delay the rest, nor can one that fails or one odd file.
 *   The guards are here so no author has to write them: the first look starts
 *   nothing, each key starts once, each trigger has a daily cap and takes one
 *   run at a time, a limit across runs holds it, and a key that won't start
 *   doesn't keep the next from starting.
 */

import {
  type CheckEvent,
  DEFAULT_RUNS_PER_DAY,
  DEFAULT_TRIGGER_CONCURRENCY,
  timeoutMs,
  type Trigger,
} from "@krapht/ork-schema";

import type { TriggerRecord, TriggerStore } from "../store/trigger-types.ts";

/** One trigger as a project declares it now. */
export type DeclaredTrigger = {
  project: string;
  id: string;
  trigger: Trigger;
  /** The hash of it and its workflow, against what was accepted. */
  hash: string;
};

export type LookResult =
  | { ok: true; events: readonly CheckEvent[] }
  | { ok: false; error: string };

export type StartResult = { ok: true } | { ok: false; error: string };

export type TriggerStanding = "live" | "new" | "changed";

/** Whether it may run: accepted as it now stands. */
export const triggerStanding = (
  declared: Pick<DeclaredTrigger, "hash">,
  record?: TriggerRecord,
): TriggerStanding => {
  if (record?.acceptedHash === undefined) return "new";
  return record.acceptedHash === declared.hash ? "live" : "changed";
};

/** How many looks in a row try a key that won't start, before giving up on it. */
export const START_TRIES = 3;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The start of the calendar day `now` is in, here. */
const startOfDay = (now: Date): string => {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
};

export const createWatcher = <T extends DeclaredTrigger>(deps: {
  store: TriggerStore;
  /** Every trigger declared now, in every project. */
  declared: () => readonly T[];
  look: (declared: T) => Promise<LookResult>;
  start: (
    declared: T,
    event: CheckEvent,
    runId: string,
  ) => Promise<StartResult>;
  newRunId: () => string;
  /** Whether this run of its is still going. */
  isRunning: (runId: string) => boolean;
  /** Why a limit across runs is holding this trigger, if one is. */
  blocked: (declared: T) => string | undefined;
  /** A line on what it did, for whoever's reading its output. */
  note?: (line: string) => void;
  now?: () => Date;
}) => {
  const { store } = deps;
  const note =
    deps.note ??
    (() => {
      // Nobody asked.
    });
  const now = deps.now ?? (() => new Date());
  const looking = new Map<string, Promise<void>>();
  const tries = new Map<string, number>();

  /** Nothing one trigger or one file does may end the watcher for the rest. */
  const guarded = (what: string, work: () => void): void => {
    try {
      work();
    } catch (error) {
      note(`${what}: ${messageOf(error)}`);
    }
  };

  const recordOf = ({ project, id }: DeclaredTrigger) =>
    store.triggerRecords(project).find(({ trigger }) => trigger === id);

  /** What keeps the next new key from starting, if anything does. */
  const heldBy = (declared: T): string | undefined => {
    const { project, id, trigger } = declared;
    const limit = deps.blocked(declared);
    if (limit !== undefined) return limit;
    const cap = trigger.maxRunsPerDay ?? DEFAULT_RUNS_PER_DAY;
    const today = store.triggerRuns(project, id, startOfDay(now()));
    if (today.length >= cap) {
      return `it has started its ${String(cap)} runs for today`;
    }
    const most = trigger.concurrency ?? DEFAULT_TRIGGER_CONCURRENCY;
    const going = store
      .triggerRuns(project, id, "")
      .filter(run => deps.isRunning(run));
    return going.length >= most
      ? `${String(going.length)} of its runs still going`
      : undefined;
  };

  /** Counts a key that didn't start, and gives up on it after a few. */
  const didNotStart = (declared: T, key: string, error: string): void => {
    const { project, id } = declared;
    store.unmarkStarted(project, id, key);
    const count = `${project}/${id}/${key}`;
    const tried = (tries.get(count) ?? 0) + 1;
    const last = tried >= START_TRIES;
    if (last) {
      tries.delete(count);
      store.giveUpOn(project, id, key, now().toISOString());
    } else {
      tries.set(count, tried);
    }
    note(
      `${id}: couldn't start for ${key}: ${error}${last ? `; tried ${String(tried)} times, so it won't try this one again` : ""}`,
    );
  };

  const startNew = async (
    declared: T,
    events: readonly CheckEvent[],
  ): Promise<{ error?: string; held?: string }> => {
    const { project, id } = declared;
    const seen = store.seenKeys(
      project,
      id,
      events.map(({ key }) => key),
    );
    let firstError: string | undefined;
    const errorSoFar = () =>
      firstError === undefined ? {} : { error: firstError };
    for (const event of events.filter(({ key }) => !seen.has(key))) {
      const held = heldBy(declared);
      if (held !== undefined) return { ...errorSoFar(), held };
      const runId = deps.newRunId();
      // Marked first: a crash here can't start the same key twice, and nor can
      // a report that lists it twice.
      const at = now().toISOString();
      if (!store.markStarted(project, id, event.key, runId, at)) continue;
      // oxlint-disable-next-line no-await-in-loop -- one start at a time, so each sees the caps as the last left them
      const started = await deps.start(declared, event, runId);
      if (started.ok) {
        tries.delete(`${project}/${id}/${event.key}`);
        note(`${id}: started run ${runId} for ${event.key}`);
      } else {
        didNotStart(declared, event.key, started.error);
        firstError ??= started.error;
      }
    }
    return errorSoFar();
  };

  const lookNow = async (declared: T): Promise<void> => {
    const { project, id, trigger } = declared;
    const at = now().toISOString();
    const result: LookResult =
      trigger.check === undefined
        ? { ok: true, events: [{ key: `schedule ${at}` }] }
        : await deps.look(declared);
    if (!result.ok) {
      store.recordLook(project, id, { at, error: result.error });
      note(`${id}: the look failed: ${result.error}`);
      return;
    }
    if (recordOf(declared)?.baselined !== true) {
      store.baselineTrigger(
        project,
        id,
        trigger.check === undefined ? [] : result.events.map(({ key }) => key),
        at,
      );
      store.recordLook(project, id, { at });
      note(
        trigger.check === undefined
          ? `${id}: first look; nothing started`
          : `${id}: first look, ${String(result.events.length)} there already; nothing started`,
      );
      return;
    }
    store.recordLook(project, id, {
      at,
      ...(await startNew(declared, result.events)),
    });
  };

  const due = (declared: DeclaredTrigger): boolean => {
    const record = recordOf(declared);
    if (triggerStanding(declared, record) !== "live") return false;
    if (record?.lookedAt === undefined) return true;
    const every = timeoutMs(declared.trigger.every) ?? 0;
    const since = now().getTime() - Date.parse(record.lookedAt);
    // A clock moved back mustn't stop it until the clock catches up.
    return since < 0 || since >= every;
  };

  const lookIfDue = (declared: T): void => {
    const { project, id } = declared;
    const key = `${project}/${id}`;
    if (looking.has(key) || !due(declared)) return;
    const done = lookNow(declared)
      .catch((error: unknown) => {
        const message = messageOf(error);
        note(`${id}: the look failed: ${message}`);
        guarded(`${id}: couldn't record the look`, () => {
          store.recordLook(project, id, {
            at: now().toISOString(),
            error: message,
          });
        });
      })
      .finally(() => {
        looking.delete(key);
      });
    looking.set(key, done);
  };

  return {
    /** Starts a look for each trigger that's due and isn't looking already. */
    tick: (): void => {
      guarded("couldn't read what the projects declare", () => {
        for (const declared of deps.declared()) {
          guarded(declared.id, () => {
            lookIfDue(declared);
          });
        }
      });
    },
    /** Waits for the looks under way. */
    settled: async (): Promise<void> => {
      await Promise.all(looking.values());
    },
  };
};
