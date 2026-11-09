/**
 * @file What the Monitor's node table says of a node besides its status: what
 *   it's doing now and how long it has taken. The server knows what a node did
 *   (`now`); what it's waiting for comes from the graph, and a wait's looks are
 *   estimates that move with the clock.
 */

import type { TreeNode, WorkflowGraph } from "@krapht/ork-server/client";

import type { Status } from "../components/status-badge.tsx";
import { formatElapsed } from "../graph/facts.ts";
import { watchFacts } from "./watch-facts.ts";

const DONE: ReadonlySet<Status> = new Set([
  "succeeded",
  "failed",
  "skipped",
  "interrupted",
]);

const list = (names: readonly string[]): string =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/** What a queued node is still waiting for, from its incoming edges. */
const afterLine = (
  id: string,
  edges: WorkflowGraph["edges"],
  statusOf: (id: string) => Status | undefined,
): string => {
  const open = edges
    .filter(({ to, from }) => {
      const status = to === id ? statusOf(from) : undefined;
      return to === id && (status === undefined || !DONE.has(status));
    })
    .map(({ from }) => from);
  return open.length === 0 ? "" : `After ${list([...new Set(open)])}`;
};

const capitalized = (line: string): string =>
  `${line.charAt(0).toUpperCase()}${line.slice(1)}`;

/** The node's "Now": empty when there's nothing worth saying. */
export const nowLine = (
  node: TreeNode,
  status: Status,
  edges: WorkflowGraph["edges"],
  statusOf: (id: string) => Status | undefined,
  now: number,
  progress?: string,
): string => {
  if (progress !== undefined) {
    const why = status === "failed" ? (node.now ?? "") : "";
    return why === "" ? progress : `${progress} · ${why}`;
  }
  if (status === "queued") return afterLine(node.id, edges, statusOf);
  if (node.watching !== undefined && !DONE.has(status)) {
    const { looks, next } = watchFacts(node.watching, now);
    const word = looks === "1" ? "look" : "looks";
    return capitalized(`${looks} ${word}, next ${next}`);
  }
  return node.now ?? "";
};

/** How long it has run, up to when it finished or its run ended. */
export const timeLine = (
  { startedAt, finishedAt }: Pick<TreeNode, "startedAt" | "finishedAt">,
  runFinishedAt: string | undefined,
  now: number,
): string => {
  if (startedAt === undefined) return "–";
  const end = finishedAt ?? runFinishedAt;
  return formatElapsed(
    (end === undefined ? now : Date.parse(end)) - Date.parse(startedAt),
  );
};

/** How many nodes have come to an end, of how many, for the header. */
export const doneCount = (statuses: Iterable<Status>): string => {
  const all = [...statuses];
  return `${String(all.filter(status => DONE.has(status)).length)} / ${String(all.length)}`;
};

/**
 * What a finished run left out, for the header: `2 skipped · 1 failure
 * handled`, or `null` when it skipped nothing and handled no failure.
 */
export const leftOut = ({
  skipped = 0,
  failuresHandled = 0,
}: {
  skipped?: number;
  failuresHandled?: number;
}): string | null => {
  const parts = [
    ...(skipped === 0 ? [] : [`${String(skipped)} skipped`]),
    ...(failuresHandled === 0
      ? []
      : [
          `${String(failuresHandled)} ${failuresHandled === 1 ? "failure" : "failures"} handled`,
        ]),
  ];
  return parts.length === 0 ? null : parts.join(" · ");
};
