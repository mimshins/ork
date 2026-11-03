/**
 * @file Says aloud what changes in the run the Monitor shows, beyond what is a
 *   notification: its going on again, and a node that failed or paused (WCAG
 *   4.1.3). Changes are gathered for a moment, so a busy run reads as sentences
 *   rather than a stream, and what the run already was when it opened is not
 *   news.
 */

import { use, useEffect, useRef } from "react";

import type { NodeFacts } from "../graph/facts.ts";
import { WorkspaceContext } from "../workspace/context.ts";
import { changesOf, type Standing, standingOf } from "./monitor-model.ts";
import type { RunView } from "./use-run-monitor.ts";

const GATHER_MS = 1000;

export const useRunAnnouncer = (
  run: RunView,
  facts: ReadonlyMap<string, NodeFacts>,
): void => {
  const workspace = use(WorkspaceContext);
  const before = useRef<Standing | null>(null);
  const gathered = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { id, live } = run;

  useEffect(() => {
    // Nothing has been read of the run yet.
    if (facts.size === 0) return;
    const now = standingOf(live, facts);
    const changes =
      before.current === null ? [] : changesOf(id, before.current, now);
    before.current = now;
    gathered.current.push(...changes);
    if (gathered.current.length === 0 || timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      workspace?.announce(gathered.current.splice(0).join(" "));
    }, GATHER_MS);
  }, [facts, id, live, workspace]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
};
