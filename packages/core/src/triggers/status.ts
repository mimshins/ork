/**
 * @file How the triggers stand (RFC-011): what `ork watch --status`, `ork
 *   doctor` and the UI show. Whether one's live, when it last looked, and
 *   what's in its way, read from the project's file and this machine's store.
 */

import { timeoutMs } from "@krapht/ork-schema";

import type { ProjectRecord } from "../project/place.ts";
import type { TriggerStore } from "../store/trigger-types.ts";
import { watchingPid } from "./lock.ts";
import { readProjectTriggers } from "./project.ts";
import { triggerStanding, type TriggerStanding } from "./watcher.ts";

export type TriggerStatus = {
  project: string;
  trigger: string;
  run: string;
  every: string;
  /** `invalid`: something in it, or the workflow it starts, is wrong. */
  standing: TriggerStanding | "invalid";
  lookedAt?: string;
  nextAt?: string;
  error?: string;
  held?: string;
  /** What's wrong, when it's `invalid`. */
  problems: string[];
  /** The warnings it's accepted with. */
  warnings: string[];
};

export type TriggersReport = {
  /** The process that's watching, if one is. */
  pid?: number;
  triggers: TriggerStatus[];
  /** Files that can't be read, and why. */
  broken: { project: string; file: string; message: string }[];
};

/** How long past its time a live trigger is before it counts as not looking. */
const LATE_FACTOR = 2;

const nextOf = (lookedAt: string | undefined, every: string) => {
  if (lookedAt === undefined) return {};
  const at = Date.parse(lookedAt) + (timeoutMs(every) ?? 0);
  return { nextAt: new Date(at).toISOString() };
};

export const triggersReport = (
  store: TriggerStore,
  projects: readonly ProjectRecord[],
  home?: string,
): TriggersReport => {
  const pid = watchingPid(store);
  const read = projects.map(place => ({
    place,
    found: readProjectTriggers(place, home, projects),
  }));
  return {
    ...(pid === undefined ? {} : { pid }),
    broken: read.flatMap(({ place, found }) =>
      found.diagnostics.map(({ message }) => ({
        project: place.id,
        file: found.file,
        message,
      })),
    ),
    triggers: read.flatMap(({ place, found }) => {
      const records = store.triggerRecords(place.id);
      return found.triggers.map(item => {
        const record = records.find(({ trigger }) => trigger === item.id);
        const errors = item.diagnostics.filter(
          ({ severity }) => severity === "error",
        );
        return {
          project: place.id,
          trigger: item.id,
          run: item.trigger.run,
          every: item.trigger.every,
          standing:
            errors.length > 0 ? "invalid" : triggerStanding(item, record),
          problems: errors.map(({ message }) => message),
          warnings: item.diagnostics
            .filter(({ severity }) => severity === "warning")
            .map(({ message }) => message),
          ...(record?.lookedAt === undefined
            ? {}
            : { lookedAt: record.lookedAt }),
          ...nextOf(record?.lookedAt, item.trigger.every),
          ...(record?.error === undefined ? {} : { error: record.error }),
          ...(record?.held === undefined ? {} : { held: record.held }),
        };
      });
    }),
  };
};

/**
 * The live triggers that haven't looked when they should have, for `ork
 * doctor`. With no process watching, that's all of them.
 */
export const lateTriggers = (
  report: TriggersReport,
  now: Date,
): TriggerStatus[] =>
  report.triggers.filter(status => {
    if (status.standing !== "live") return false;
    if (report.pid === undefined) return true;
    if (status.lookedAt === undefined) return false;
    const every = timeoutMs(status.every) ?? 0;
    const since = now.getTime() - Date.parse(status.lookedAt);
    return since < 0 || since > every * LATE_FACTOR;
  });
