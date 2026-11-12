/**
 * @file `ork watch` (RFC-011): looks at what each registered project's triggers
 *   declare, and starts a run for each new thing they report. One per machine,
 *   in the foreground or with `--detach`; Ork installs nothing to keep it
 *   alive. It runs only what was accepted here, and accepting takes a terminal,
 *   so a browser tab can't approve code to run with nobody there, nor a program
 *   by accident.
 */

import { homedir } from "node:os";
import path from "node:path";

import {
  createWatcher,
  declaredTriggers,
  detachRun,
  type EventStore,
  liveStatus,
  newRunId,
  openStore,
  type ProjectTrigger,
  readProjectTriggers,
  runGh,
  startFollowUpChecks,
  stillTheSameProcess,
  takeWatchLock,
  triggersReport,
  triggerStanding,
  watchingPid,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { confirm, plain, style, write, writeErr } from "../output.ts";
import { limitsRefusal, runLimits } from "../run/limits.ts";
import { lookAt } from "../watch/look.ts";
import {
  acceptLines,
  brokenLines,
  dueLines,
  statusLines,
  unacceptableLines,
} from "../watch/report.ts";
import { startTriggerRun } from "../watch/start.ts";
import { acceptRefusal } from "./in-a-run.ts";

/** How often it sees what's due. A trigger looks once a minute at most. */
const TICK_MS = 10_000;

const watchLoop = async (store: EventStore): Promise<number> => {
  const lock = takeWatchLock(store);
  if (!lock.ok) {
    writeErr(`ork watch is already running (process ${String(lock.pid)}).`);
    return 1;
  }
  const stopping = new AbortController();
  const watcher = createWatcher({
    store,
    declared: () => declaredTriggers(store.projects()),
    look: ({ place, id, trigger }) =>
      trigger.check === undefined
        ? Promise.resolve({ ok: true, events: [] })
        : lookAt({
            place,
            id,
            check: trigger.check,
            signal: stopping.signal,
          }),
    start: (
      { place, id, trigger, workflow, workflowFile, workflowHash },
      event,
      runId,
    ) =>
      startTriggerRun({
        store,
        place,
        id,
        trigger,
        workflow,
        workflowFile,
        workflowHash,
        event,
        runId,
      }),
    newRunId: () => newRunId(store),
    isRunning: runId => {
      const [run] = store.lookup(runId);
      if (run === undefined || liveStatus(run) !== "running") return false;
      // Another process may have been given its id since.
      const last = store.events(run.id).at(-1)?.at ?? run.startedAt;
      return stillTheSameProcess(run.pid, last);
    },
    blocked: ({ place, workflow }) =>
      limitsRefusal(runLimits(store, place), workflow)[0],
    note: line => {
      write(`${style("dim", new Date().toISOString())} ${plain(line)}`);
    },
  });
  const { promise: stopped, resolve: stop } = Promise.withResolvers<void>();
  const onSignal = () => {
    stop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  write("▸ watching. `ork watch --status` says what's live.");
  watcher.tick();
  const timer = setInterval(() => {
    watcher.tick();
  }, TICK_MS);
  // Follow-ups waiting on a merge come due while ork watch runs.
  const stopChecks = startFollowUpChecks({
    rows: store,
    gh: runGh,
    projects: () => store.projects().map(project => project.root),
    onDue: due => {
      for (const line of dueLines(due)) write(line);
    },
    onError: error => {
      writeErr(`follow-ups: ${error}`);
    },
  });
  await stopped;
  stopChecks();
  clearInterval(timer);
  stopping.abort();
  await watcher.settled();
  lock.release();
  return 0;
};

const detach = async (store: EventStore): Promise<number> => {
  const running = watchingPid(store);
  if (running !== undefined) {
    writeErr(`ork watch is already running (process ${String(running)}).`);
    return 1;
  }
  const started = await detachRun({
    store,
    runId: "watch",
    cwd: homedir(),
    runDir: path.join(homedir(), ".ork", "watch"),
    args: ["watch"],
    started: pid => pid !== undefined && watchingPid(store) === pid,
  });
  if (!started.ok) {
    writeErr(started.error);
    return 1;
  }
  write(`▸ watching in the background; its output is in ${started.log}`);
  return 0;
};

const stopWatching = (store: EventStore): number => {
  const pid = watchingPid(store);
  if (pid === undefined) {
    write("ork watch isn't running.");
    return 0;
  }
  process.kill(pid, "SIGTERM");
  write(`Told ork watch (process ${String(pid)}) to stop.`);
  return 0;
};

const hasError = ({ diagnostics }: ProjectTrigger): boolean =>
  diagnostics.some(({ severity }) => severity === "error");

/** Asks about each trigger that's new or changed, in this terminal. */
const accept = async (store: EventStore): Promise<number> => {
  const refused = acceptRefusal();
  if (refused !== null) {
    writeErr(refused);
    return 1;
  }
  if (!process.stdin.isTTY) {
    writeErr(
      "`ork watch --accept` asks in a terminal: it approves code to run with nobody there.",
    );
    return 1;
  }
  const projects = store.projects();
  const read = projects.map(place => ({
    place,
    found: readProjectTriggers(place, undefined, projects),
  }));
  for (const { place, found } of read) {
    const broken = found.diagnostics.map(({ message }) => ({
      project: place.id ?? "",
      file: found.file,
      message,
    }));
    for (const line of brokenLines(broken)) write(line);
    for (const item of found.triggers.filter(hasError)) {
      for (const line of unacceptableLines(item)) write(line);
    }
  }
  const waiting = read.flatMap(({ place, found }) => {
    const records = store.triggerRecords(place.id);
    return found.triggers.flatMap(item => {
      const standing = triggerStanding(
        item,
        records.find(({ trigger }) => trigger === item.id),
      );
      return hasError(item) || standing === "live" ? [] : [{ item, standing }];
    });
  });
  if (waiting.length === 0) {
    write("No new or changed triggers to accept.");
    return 0;
  }
  for (const { item, standing } of waiting) {
    for (const line of acceptLines(item, standing)) write(line);
    // oxlint-disable-next-line no-await-in-loop -- one question at a time
    const yes = await confirm(
      "Accept this trigger, to run with nobody there? [y/N] ",
    );
    if (yes) {
      const project = item.place.id;
      if (project !== undefined) {
        store.acceptTrigger(project, item.id, item.hash);
        write(`Accepted ${plain(item.id)}; its first look starts nothing.`);
      }
    }
  }
  return 0;
};

export const watch = defineCommand({
  meta: {
    name: "watch",
    description:
      "Look at each project's triggers, and start a run for each new thing they report",
  },
  args: {
    detach: {
      type: "boolean",
      description: "Watch in the background",
      default: false,
    },
    status: {
      type: "boolean",
      description: "Say what's live, and when each trigger last looked",
      default: false,
    },
    accept: {
      type: "boolean",
      description: "Accept new or changed triggers, in a terminal",
      default: false,
    },
    stop: {
      type: "boolean",
      description: "Stop the ork watch that's running",
      default: false,
    },
  },
  run: async ({ args }) => {
    const store = openStore();
    try {
      if (args.status) {
        const report = triggersReport(store, store.projects());
        for (const line of statusLines(report)) write(line);
      } else if (args.stop) {
        process.exitCode = stopWatching(store);
      } else if (args.accept) {
        process.exitCode = await accept(store);
      } else if (args.detach) {
        process.exitCode = await detach(store);
      } else {
        process.exitCode = await watchLoop(store);
      }
    } finally {
      store.close();
    }
  },
});
