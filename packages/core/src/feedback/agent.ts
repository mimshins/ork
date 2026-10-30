/**
 * @file Agent feedback (specs/feedback.md): each session's `feedback` port. A
 *   report becomes a `feedback.recorded` run event; Ork caps reports per
 *   session and drops a run's duplicates, so feedback stays cheap in tokens.
 */

import type { CompiledGraph } from "../graph/types.ts";
import type { RunEvent } from "../run/types.ts";
import { maskSecrets } from "../store/mask.ts";
import { fingerprint, targetOf } from "./fingerprint.ts";
import type { FeedbackPort, FeedbackReport } from "./types.ts";

/** Reports one session may make. */
export const FEEDBACK_CAP = 3;

const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_EVIDENCE = 10;

export type AgentFeedback = {
  /** One session's port; `template` is a spawned worker's declared node. */
  port: (id: string, template?: string) => FeedbackPort;
};

export const createFeedback = ({
  graph,
  onEvent,
}: {
  graph: CompiledGraph;
  onEvent: (event: RunEvent) => void;
}): AgentFeedback => {
  const seen = new Set<string>();
  return {
    port: (id, template) => {
      let left = FEEDBACK_CAP;
      const nodeType = graph.nodes.get(template ?? id)?.node.type;
      return {
        report: draft => {
          const title = maskSecrets(draft.title.trim()).slice(0, MAX_TITLE);
          if (title === "") return { ok: false, error: "the title is empty" };
          if (left === 0) {
            return {
              ok: false,
              error: `you already sent ${String(FEEDBACK_CAP)} reports in this session; keep the rest for the work`,
            };
          }
          const target = targetOf(draft);
          const print = fingerprint({ target, kind: draft.kind, title });
          if (seen.has(print)) return { ok: true, fingerprint: print };
          seen.add(print);
          left -= 1;
          const feedback: FeedbackReport = {
            source: "agent",
            kind: draft.kind,
            target,
            severity: draft.severity ?? "medium",
            title,
            body: maskSecrets(draft.body?.trim() ?? "").slice(0, MAX_BODY),
            evidence: (draft.evidence ?? [])
              .slice(0, MAX_EVIDENCE)
              .map(e => maskSecrets(e)),
            fingerprint: print,
            origin: nodeType === undefined ? {} : { nodeType },
          };
          onEvent({ type: "feedback.recorded", node: id, feedback });
          return { ok: true, fingerprint: print };
        },
      };
    },
  };
};
