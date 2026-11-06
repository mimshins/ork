/**
 * @file Asks the server what the Context panel's node loads: a run's node or a
 *   Builder's. The newest ask wins, and an answer to an older one is dropped.
 *   Asking again about the same node (a draft edit, Reload, Try again) keeps
 *   the last answer on screen until the new one comes; a failure then keeps it
 *   too, beside the error, and is said through the workspace's live region.
 */

import type { NodeContextAnswer } from "@krapht/ork-server/client";
import { use, useCallback, useEffect, useRef, useState } from "react";

import type { ContextTarget } from "../state/context-target.ts";
import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { failedWords } from "./context-model.ts";

/** A target with a node chosen. */
export type NodeTarget = ContextTarget & { node: string };

export type NodeContext = {
  answer: NodeContextAnswer | null;
  /** The last ask's failure, in the server's words. */
  error: string | null;
  loading: boolean;
};

/** Which node a target is, whatever its revision. */
export const nodeKeyOf = (target: NodeTarget): string =>
  target.kind === "run"
    ? `run/${target.run}/${target.node}`
    : `builder/${target.project}/${target.workflow}/${target.node}`;

const EMPTY: NodeContext = { answer: null, error: null, loading: true };

export const useNodeContext = (
  target: NodeTarget,
): NodeContext & { reload: () => void } => {
  const { client } = useAppState();
  const workspace = use(WorkspaceContext);
  const [shown, setShown] = useState<NodeContext>(EMPTY);
  // What's on screen when an ask comes back, for the words of a failure.
  const answered = useRef(false);
  answered.current = shown.answer !== null;
  const [asks, setAsks] = useState(0);
  const revision = target.kind === "builder" ? target.revision : 0;
  const key = nodeKeyOf(target);
  useEffect(() => {
    let current = true;
    setShown(before => ({ ...before, loading: true }));
    const call =
      target.kind === "run"
        ? client.call("runContext", {
            params: { id: target.run, node: target.node },
          })
        : client.call("builderContext", {
            params: {
              id: target.project,
              name: target.workflow,
              node: target.node,
            },
          });
    const take = async (): Promise<void> => {
      const result = await call;
      if (!current) return;
      if (!result.ok) {
        workspace?.announce(failedWords(result.error, answered.current));
      }
      setShown(before =>
        result.ok
          ? { answer: result.data, error: null, loading: false }
          : { answer: before.answer, error: result.error, loading: false },
      );
    };
    void take();
    return () => {
      current = false;
    };
    // The key names the node; `target` is read for it, and the revision and
    // asks are what make it ask again.
    // oxlint-disable-next-line react/exhaustive-deps -- see above
  }, [client, workspace, key, revision, asks]);
  const reload = useCallback(() => {
    setAsks(n => n + 1);
  }, []);
  return { ...shown, reload };
};
