/**
 * @file The decisions that have left the open list while this page watched,
 *   with how each ended. The overview stream sends only open ones, so when one
 *   leaves it is read on its own, which says what was answered and who gave the
 *   answer.
 */

import type { Client, DecisionRecord } from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

/** How many are kept, newest first. */
export const SETTLED_KEPT = 20;

export const createDecisionHistory = (client: Client) => {
  const settled = Container.create<readonly DecisionRecord[]>([]);
  let open = new Map<string, DecisionRecord>();

  const settle = async (left: DecisionRecord): Promise<void> => {
    const answer = await client.call("decision", { params: { id: left.id } });
    // Unreadable, it still left: say what is known of it.
    const record = answer.ok ? answer.data : left;
    void settled.setValue(
      [record, ...settled.getValue()].slice(0, SETTLED_KEPT),
    );
  };

  return {
    settled,
    /** The open list has changed. */
    saw: (next: readonly DecisionRecord[] | null): void => {
      const now = new Map((next ?? []).map(record => [record.id, record]));
      for (const [id, record] of open) {
        if (!now.has(id)) void settle(record);
      }
      open = now;
    },
  };
};
