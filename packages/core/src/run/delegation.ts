/**
 * @file A leader's ownership port (ADR-017): `delegate` runs declared children
 *   and `spawn` runs new instances of a child worker, in parallel, and both
 *   block until every child has reported. The scheduler runs the children; this
 *   module checks what the leader asked for and shapes the reports.
 */

import type { CompiledGraph } from "../graph/types.ts";
import { DESCRIPTION_MAX } from "../runtime/description.ts";
import type {
  ChildReport,
  DelegateTask,
  Delegation,
  OwnedChild,
  Ownership,
  SpawnTask,
} from "../runtime/types.ts";
import { endFor, failedWith, stoppedEnd } from "./ended.ts";
import { forEachOf } from "./fan-out.ts";
import type { Activation } from "./handle.ts";
import type { Holds } from "./holds.ts";
import type { Slots } from "./slots.ts";
import type { Brief, NodeResult } from "./types.ts";

/** Node types a leader can hand work to. */
const DELEGABLE = new Set(["agent.leader", "agent.worker"]);

export type DelegationHooks = {
  graph: CompiledGraph;
  leader: string;
  /** Runs one child to its end, outside the flow; it reports to the leader. */
  runChild: (
    child: { id: string; template?: string; description?: string },
    brief: Brief,
  ) => Promise<NodeResult>;
  /** Whether a node is running now (in the flow or for another leader). */
  isRunning: (id: string) => boolean;
  /** Commits the leader's work so children branch from it. */
  checkpoint: () => Promise<string | null>;
  /** Releases everything the leader holds, so its children can claim it. */
  releaseClaims: () => string[];
  /** Lends the leader's session slot to its children while it waits. */
  lend: () => void;
  reclaim: () => Promise<void>;
};

/** What starts work outside the queue: a leader's children, a list's items. */
export type StartHooks = {
  slots: Slots;
  holds: Holds;
  /** Aborted when the whole run stops. */
  signal: AbortSignal;
  /** Why the run stopped, first reason first. */
  reasons: readonly string[];
  isStopped: () => boolean;
  /** True, and the run stops, once its budget or a quota is spent. */
  budgetSpent: () => boolean;
  /** Runs one activation and records it; routing is the caller's. */
  perform: (activation: Activation) => Promise<NodeResult>;
};

/** A child a leader delegated to: waits for a slot, runs, reports back. */
export const createRunChild =
  (hooks: StartHooks): DelegationHooks["runChild"] =>
  async (child, brief) => {
    await hooks.slots.take();
    try {
      // A paused run or child starts its delegated work once it continues.
      await hooks.holds
        .forNode(child.id, child.template)
        .wait("start", hooks.signal);
      if (hooks.isStopped() || hooks.budgetSpent()) {
        const why = `not started: ${hooks.reasons[0] ?? "the run stopped"}`;
        const end = hooks.budgetSpent()
          ? endFor("budget_limit", {}, why)
          : stoppedEnd(hooks.signal, why);
        return failedWith(end, { status: "fail", summary: why });
      }
      return await hooks.perform({ ...child, input: undefined, brief });
    } finally {
      hooks.slots.release();
    }
  };

const rejected = (child: string, error: string): ChildReport => ({
  child,
  ok: false,
  output: { status: "fail", summary: error },
  error,
});

const reportOf = (child: string, result: NodeResult): ChildReport => {
  const report: ChildReport = { child, ok: result.ok, output: result.output };
  if (result.error !== undefined) report.error = result.error;
  return report;
};

type Job = {
  id: string;
  template?: string;
  brief: string;
  description?: string;
};

/** A job with the task's description clipped once; blank is none. */
const jobOf = (
  id: string,
  task: DelegateTask | SpawnTask,
  template?: string,
): Job => {
  const job: Job = { id, brief: task.brief };
  if (template !== undefined) job.template = template;
  // Whitespace and control characters (newline, ANSI escape) fold to one space so a label stays on one line.
  const description = task.description
    ?.replaceAll(/[\s\p{Cc}]+/gu, " ")
    .trim()
    .slice(0, DESCRIPTION_MAX);
  if (description !== undefined && description !== "") {
    job.description = description;
  }
  return job;
};

export const createOwnership = (hooks: DelegationHooks): Ownership => {
  const { graph, leader } = hooks;
  const owner = graph.nodes.get(leader);
  // A fanned child runs from its edges; an enum that named it would fail the call.
  const isFanned = (id: string) =>
    forEachOf(graph.nodes.get(id)?.node) !== undefined;
  const children: OwnedChild[] = (owner?.children ?? []).flatMap(id => {
    const node = graph.nodes.get(id)?.node;
    if (node === undefined || !DELEGABLE.has(node.type) || isFanned(id)) {
      return [];
    }
    const child: OwnedChild = { id, type: node.type };
    if (node.description !== undefined) child.description = node.description;
    return [child];
  });
  const templates = children
    .filter(c => c.type === "agent.worker")
    .map(c => c.id);
  const leaderNode = owner?.node;
  const maxWorkers =
    leaderNode?.type === "agent.leader" ? (leaderNode.maxWorkers ?? 0) : 0;
  const spawned: string[] = [];

  /** Runs the accepted jobs in parallel; the slot goes to them meanwhile. */
  const runJobs = async (jobs: (Job | ChildReport)[]): Promise<Delegation> => {
    const accepted = jobs.filter((j): j is Job => "brief" in j);
    const notes: string[] = [];
    if (accepted.length > 0) {
      const problem = await hooks.checkpoint();
      if (problem !== null) {
        notes.push(
          `Your uncommitted work could not be committed (${problem}); the children started from your branch's last commit.`,
        );
      }
      const released = hooks.releaseClaims().map(r => `\`${r}\``);
      if (released.length > 0) {
        notes.push(
          `Your claims on ${released.join(", ")} were released while your children worked; claim again before you edit.`,
        );
      }
    }
    hooks.lend();
    try {
      const results = await Promise.all(
        jobs.map(async job => {
          if (!("brief" in job)) return job;
          const { brief, ...child } = job;
          const result = await hooks.runChild(child, {
            from: leader,
            text: brief,
          });
          return reportOf(job.id, result);
        }),
      );
      return { reports: results, notes };
    } finally {
      await hooks.reclaim();
    }
  };

  const delegate = (tasks: DelegateTask[]): Promise<Delegation> => {
    const seen = new Set<string>();
    const jobs = tasks.map((task): Job | ChildReport => {
      if (!children.some(c => c.id === task.child)) {
        const names = children.map(c => c.id).join(", ");
        return rejected(
          task.child,
          `not one of your children (${names === "" ? "you have none" : names})`,
        );
      }
      if (seen.has(task.child) || hooks.isRunning(task.child)) {
        return rejected(
          task.child,
          templates.includes(task.child) && maxWorkers > 0
            ? "already running; use spawn_worker for another instance"
            : "already running",
        );
      }
      seen.add(task.child);
      return jobOf(task.child, task);
    });
    return runJobs(jobs);
  };

  const nextInstance = (template: string): string => {
    for (let n = 2; ; n += 1) {
      const id = `${template}-${String(n)}`;
      if (!graph.nodes.has(id) && !spawned.includes(id)) return id;
    }
  };

  const spawn = (tasks: SpawnTask[]): Promise<Delegation> => {
    const jobs = tasks.map((task): Job | ChildReport => {
      if (!templates.includes(task.template)) {
        const names = templates.join(", ");
        return rejected(
          task.template,
          `not one of your child workers (${names === "" ? "you have none" : names})`,
        );
      }
      if (spawned.length >= maxWorkers) {
        return rejected(
          task.template,
          `no workers left to spawn (maxWorkers: ${String(maxWorkers)})`,
        );
      }
      const id = nextInstance(task.template);
      spawned.push(id);
      return jobOf(id, task, task.template);
    });
    return runJobs(jobs);
  };

  return {
    children,
    fanned: (owner?.children ?? []).filter(id => isFanned(id)),
    templates,
    workersLeft: () => Math.max(0, maxWorkers - spawned.length),
    delegate,
    spawn,
  };
};
