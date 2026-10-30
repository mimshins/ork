/**
 * @file A leader's ownership port (ADR-017): `delegate` runs declared children
 *   and `spawn` runs new instances of a child worker, in parallel, and both
 *   block until every child has reported. The scheduler runs the children; this
 *   module checks what the leader asked for and shapes the reports.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type {
  ChildReport,
  DelegateTask,
  Delegation,
  OwnedChild,
  Ownership,
  SpawnTask,
} from "../runtime/types.ts";
import type { Brief, NodeResult } from "./types.ts";

/** Node types a leader can hand work to. */
const DELEGABLE = new Set(["claude.leader", "claude.worker"]);

export type DelegationHooks = {
  graph: CompiledGraph;
  leader: string;
  /** Runs one child to its end, outside the flow; it reports to the leader. */
  runChild: (
    child: { id: string; template?: string },
    brief: Brief,
  ) => Promise<NodeResult>;
  /** Whether a node is running now (in the flow or for another leader). */
  isRunning: (id: string) => boolean;
  /** Commits the leader's work so children branch from it. */
  checkpoint: () => Promise<string | null>;
  /** Lends the leader's session slot to its children while it waits. */
  lend: () => void;
  reclaim: () => Promise<void>;
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

type Job = { id: string; template?: string; brief: string };

export const createOwnership = (hooks: DelegationHooks): Ownership => {
  const { graph, leader } = hooks;
  const owner = graph.nodes.get(leader);
  const children: OwnedChild[] = (owner?.children ?? []).flatMap(id => {
    const node = graph.nodes.get(id)?.node;
    if (node === undefined || !DELEGABLE.has(node.type)) return [];
    const child: OwnedChild = { id, type: node.type };
    if (node.description !== undefined) child.description = node.description;
    return [child];
  });
  const templates = children
    .filter(c => c.type === "claude.worker")
    .map(c => c.id);
  const leaderNode = owner?.node;
  const maxWorkers =
    leaderNode?.type === "claude.leader" ? (leaderNode.maxWorkers ?? 0) : 0;
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
    }
    hooks.lend();
    try {
      const results = await Promise.all(
        jobs.map(async job => {
          if (!("brief" in job)) return job;
          const child: { id: string; template?: string } = { id: job.id };
          if (job.template !== undefined) child.template = job.template;
          const result = await hooks.runChild(child, {
            from: leader,
            text: job.brief,
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
      return { id: task.child, brief: task.brief };
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
      return { id, template: task.template, brief: task.brief };
    });
    return runJobs(jobs);
  };

  return {
    children,
    templates,
    workersLeft: () => Math.max(0, maxWorkers - spawned.length),
    delegate,
    spawn,
  };
};
