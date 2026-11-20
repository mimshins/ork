/**
 * @file Where a run's feedback comes from, beyond what its events say: Ork's
 *   version (bound from the CLI's `package.json`) and the workflow file's
 *   content hash, the signals observer built from them; the feedback and
 *   `follow_up` ports of the one node `ork run --node` runs; and where an
 *   "always" permission answer goes (RFC-028).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  addAllowRules,
  type CompiledGraph,
  type ControlOptions,
  createFeedback,
  createFollowUps,
  createSignals,
  type EventStore,
  type FeedbackPort,
  type FollowUpPort,
  loadProject,
  placeFiles,
  type ProjectPlace,
  type RunEvent,
  runScrubber,
  type SignalOptions,
} from "@krapht/ork-core";
import { maskedNamesOfRun } from "@krapht/ork-nodes";
import type { Workflow } from "@krapht/ork-schema";

import { ORK_VERSION } from "../__build_info__.ts";
import { followUpSink } from "../follow-ups/context.ts";

/** Ork's version and the workflow's hash, for the run's feedback records. */
/** The Ork version a run records in `run.started` and `run.resumed`. */
export const ORK_RUN_VERSION: string = ORK_VERSION;

export const feedbackOrigin = (workflowFile: string): SignalOptions => {
  const origin: SignalOptions = { version: ORK_VERSION };
  try {
    origin.workflowHash = createHash("sha256")
      .update(readFileSync(workflowFile))
      .digest("hex")
      .slice(0, 12);
  } catch {
    // The run reports a missing file itself.
  }
  return origin;
};

/**
 * Feedback Ork derives from the run's events, recorded right after them; a
 * tool's message is masked with the values the run masks. A shell rule is
 * proposed from the project's answered permissions across its runs, against the
 * project file's own `permissions.allow`, for that file.
 */
export const signalsOf = (
  options: { cwd: string; file: string; store: EventStore },
  workflow: Workflow,
  place: ProjectPlace,
): ReturnType<typeof createSignals> => {
  const file = placeFiles(place).rules;
  const { project } = loadProject(place.root, file);
  return createSignals({
    ...feedbackOrigin(path.resolve(options.cwd, options.file)),
    scrub: runScrubber(
      maskedNamesOfRun(workflow, place, options.store.projects()),
      process.env,
    ),
    permissions: {
      decisions: () =>
        options.store.decisions({ project: place.root, status: "answered" }),
      allow: project?.permissions?.allow ?? [],
      file,
    },
  });
};

/**
 * The run control's options for an "always" answer: the rules go to the
 * project's own rules file, in the user's checkout (never a node's worktree),
 * and a failed write is told on the run's terminal.
 */
export const alwaysOptions = (
  place: ProjectPlace,
  err: (line: string) => void,
): Pick<ControlOptions, "rulesFile" | "rememberAlways" | "warn"> => {
  const rulesFile = placeFiles(place).rules;
  return {
    rulesFile,
    rememberAlways: rules => {
      addAllowRules(rulesFile, rules);
    },
    warn: err,
  };
};

/**
 * Node `id`'s feedback port (with a graph) and `follow_up` port, kept as the
 * project's rule says; both mask the values of what its run masks.
 */
export const nodeReports = (
  options: {
    store: EventStore;
    place: ProjectPlace;
    home?: string | undefined;
    runId: string;
    id: string;
    cwd: string;
  },
  {
    workflow,
    graph,
    record,
  }: {
    workflow: Workflow;
    graph: CompiledGraph | null;
    record: (event: RunEvent) => void;
  },
): { feedback?: FeedbackPort; followUps: FollowUpPort } => {
  const { place, id } = options;
  const scrub = runScrubber(
    maskedNamesOfRun(workflow, place, options.store.projects()),
    process.env,
  );
  const sink = followUpSink(options);
  return {
    ...(graph === null
      ? {}
      : {
          feedback: createFeedback({ graph, onEvent: record, scrub }).port(id),
        }),
    followUps: createFollowUps({ runId: options.runId, sink, scrub }).port(
      id,
      options.cwd,
    ),
  };
};
