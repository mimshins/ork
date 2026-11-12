/**
 * @file What the Follow-ups panel reads: every registered project's follow-ups
 *   (the server lists one project at a time), put together as one list with the
 *   project each belongs to, and whether the server could check the pull
 *   requests they wait on. The due count the tab shows comes on the overview
 *   stream instead (overview.ts).
 */

import type {
  CallResult,
  Client,
  FollowUp,
  FollowUpsDue,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

/** A follow-up with the registered project it is in. */
export type FollowUpRow = FollowUp & {
  /** The project's id, as `ork projects` names it. */
  projectId: string;
};

export type FollowUpsRead = {
  rows: FollowUpRow[];
  /** The registered projects, by id. */
  projects: string[];
  /** Whether the due check could read pull requests, and why not. */
  checker: { available: boolean; errors: string[] };
};

/** The stream's due count before it says anything: none are due. */
export const NONE_DUE: FollowUpsDue = { count: 0, items: [] };

export const readFollowUps = async (
  client: Client,
): Promise<CallResult<FollowUpsRead>> => {
  const projects = await client.call("projects");
  if (!projects.ok) return projects;
  const lists = await Promise.all(
    projects.data.map(async project => ({
      project,
      answer: await client.call("followUps", {
        params: { id: project.id },
        query: { status: "all" },
      }),
    })),
  );
  const rows: FollowUpRow[] = [];
  const errors: string[] = [];
  for (const { project, answer } of lists) {
    if (!answer.ok) return answer;
    errors.push(...answer.data.checker.errors);
    for (const f of answer.data.followUps) {
      rows.push({ ...f, projectId: project.id });
    }
  }
  return {
    ok: true,
    status: 200,
    data: {
      rows,
      projects: projects.data.map(project => project.id),
      checker: { available: errors.length === 0, errors: [...new Set(errors)] },
    },
  };
};

/** The panel's filters, which outlive a change of layout. */
export const createFollowUpsFilter = (all: string) =>
  Container.create({ status: "open", kind: "all", for: "all", project: all });
