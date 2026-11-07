/**
 * @file The upgrade `ork ui` offers, which is `ork upgrade`'s
 *   (specs/cli/updates.md): the plan asks the registry now and records the
 *   answer as `ork upgrade` does, then gives core's plan with an id; running it
 *   rebuilds the plan and runs the server's own command only when the id the
 *   person read still matches, so the page never sends a command.
 */

import { createHash } from "node:crypto";

import {
  detectInstaller,
  fetchLatest,
  planUpgrade,
  readUpdateCache,
  registryOf,
  releaseNotes,
  runInstall,
  runningRunIds,
  runningScript,
  writeUpdateCache,
} from "@krapht/ork-core";

import type { ServerContext } from "./context.ts";
import type { UpgradeJob, UpgradePlanView } from "./contract-update.ts";
import { accepted, fail, type Reply } from "./router.ts";
import { startJob } from "./upgrade-job.ts";

/** How long the plan waits on the registry, as `ork upgrade`. */
const ASK_TIMEOUT_MS = 15_000;

export const NO_UPGRADE =
  "This server can't upgrade Ork; run `ork upgrade` in a terminal.";

export const BUSY = "An upgrade is already running.";

const UNREACHABLE =
  "Could not reach the npm registry to look for a new version. Nothing was run.";

const ADVICE =
  "Ork runs only a package manager's own command from here; this one is yours to run.";

/** Records what the registry said, as `ork upgrade` does. */
const remember = (file: string, latest: string, notified: boolean): void => {
  try {
    const now = new Date().toISOString();
    writeUpdateCache(file, {
      ...readUpdateCache(file),
      checkedAt: now,
      latest,
      ...(notified ? { notified: { version: latest, at: now } } : {}),
    });
  } catch {
    // Only the record; the plan itself is unaffected.
  }
};

const idOf = (parts: unknown): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

/** Asks the registry now and says what an upgrade would do. */
export const askPlan = async (
  context: ServerContext,
): Promise<UpgradePlanView | null> => {
  const { updates, version: current } = context;
  const { options } = updates;
  if (options === undefined) return null;
  const registry = registryOf(options.env ?? process.env);
  const latest = await fetchLatest(options.name, {
    ...(registry === undefined ? {} : { registry }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    timeoutMs: ASK_TIMEOUT_MS,
    current,
  });
  const script = options.script ?? runningScript();
  const plan = planUpgrade({ name: options.name, current, latest, script });
  if (plan.kind === "unreachable") return plan;
  if (latest !== null) remember(updates.file, latest, plan.kind !== "latest");
  updates.forget();
  if (plan.kind === "latest") return { kind: "latest", current };
  const shared = {
    current,
    latest: plan.latest,
    releaseNotes: releaseNotes(options.name, plan.latest),
    running: runningRunIds(context.store),
  };
  if (plan.kind === "command") {
    const command = [...plan.argv];
    const { id, label } = plan.installer;
    return {
      kind: "command",
      planId: idOf([plan.kind, plan.latest, id, command]),
      ...shared,
      installer: { id, label },
      command,
    };
  }
  const installer = detectInstaller(script);
  return {
    kind: "advice",
    planId: idOf([plan.kind, plan.latest, installer?.id, plan.text]),
    ...shared,
    installer:
      installer === undefined
        ? null
        : { id: installer.id, label: installer.label },
    text: plan.text,
    words: plan.words,
    commands: [...plan.commands],
  };
};

const changed = (
  plan: Exclude<UpgradePlanView, { kind: "unreachable" }>,
): string => {
  const now =
    plan.kind === "latest"
      ? `Ork ${plan.current} is the latest version now`
      : `Ork ${plan.latest} is out now`;
  return `The plan changed since you read it: ${now}. Read it again before upgrading.`;
};

const running = (context: ServerContext): boolean =>
  context.updates.job()?.view().state === "running";

/** Runs the plan the person read, when it is still the plan. */
export const startUpgrade = async (
  context: ServerContext,
  planId: string,
): Promise<Reply<{ job: UpgradeJob }>> => {
  const { updates } = context;
  const { options } = updates;
  if (options === undefined) return fail(400, NO_UPGRADE);
  if (running(context)) return fail(409, BUSY);
  const plan = await askPlan(context);
  // Another tab may have started one while the registry was asked.
  if (running(context)) return fail(409, BUSY);
  if (plan === null || plan.kind === "unreachable") {
    return fail(400, UNREACHABLE);
  }
  if (plan.kind === "latest" || plan.planId !== planId) {
    return fail(409, changed(plan));
  }
  if (plan.kind === "advice") return fail(400, ADVICE);
  const job = startJob(
    plan.latest,
    plan.command,
    options.install ?? runInstall,
    updates.forget,
  );
  updates.setJob(job);
  return accepted({ job: job.view() });
};
