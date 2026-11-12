/**
 * @file What a run shares between its nodes' sessions, reached through each
 *   session's ports: the message bus (`bus.ts`), claims (`claims.ts`), the
 *   agents' feedback and follow-ups (`reports.ts`), and whose questions go to
 *   their leader first (`owners.ts`).
 */

import type { Scope } from "../expr/evaluate.ts";
import { createBus } from "./bus.ts";
import { createClaims } from "./claims.ts";
import type { RunHandle, RunOptions } from "./handle.ts";
import type { Holds, Stops } from "./holds.ts";
import { createOwners } from "./owners.ts";
import { createSessionReports } from "./reports.ts";
import { createRules } from "./rules.ts";
import type { Slots } from "./slots.ts";
import type { ExecuteContext } from "./types.ts";

export const createRunPorts = ({
  options,
  runId,
  slots,
  scope,
  stopping,
}: {
  options: RunOptions;
  runId: string;
  slots?: Slots | undefined;
  /** What a `notify:` reads, once its node's output is recorded. */
  scope: () => Scope;
  /** Aborted when the whole run stops. */
  stopping: AbortSignal;
}) => {
  const { graph, onEvent, relay, scrub } = options;
  const mail = options.replay?.mail;
  const bus = createBus({ graph, onEvent, mail, relay, slots });
  const claims = createClaims({ graph, onEvent, notify: bus.notify });
  const reports = createSessionReports({
    graph,
    runId,
    sink: options.followUps,
    onEvent,
  });
  const send = bus.rule;
  const rules = createRules({ graph, send, scope, stopping, scrub });
  return {
    bus,
    /** Each node's latest session, and whose questions go to a leader first. */
    owners: createOwners(graph),
    /** One activation's ports; `template` is a spawned worker's node. */
    forNode: (
      id: string,
      template: string | undefined,
      cwd: string,
    ): Pick<
      ExecuteContext,
      "mailbox" | "claims" | "feedback" | "followUps"
    > => ({
      mailbox: bus.mailbox(id, template),
      claims: claims.port(id, template, cwd),
      ...reports.port(id, template, cwd),
    }),
    /** Sends what a node's fresh result declares (`notify:`). */
    fireRules: rules.fire,
    /** The activation of `id` ended: its claims are released. */
    finished: (id: string): void => {
      claims.releaseAll(id);
    },
  };
};

/** What a run's handle does to its nodes, once the run has its ports. */
export const runControls = (
  ports: ReturnType<typeof createRunPorts>,
  holds: Holds,
  stops: Stops,
  onEvent: RunOptions["onEvent"],
): Pick<
  RunHandle,
  "pause" | "proceed" | "stopNode" | "tell" | "receive" | "notice"
> => ({
  pause: node => holds.pause(node),
  proceed: node => holds.proceed(node),
  stopNode: node => stops.stop(node),
  tell: ports.bus.tell,
  receive: ports.bus.receive,
  notice: (node, text) => {
    ports.bus.notify(node, text);
    onEvent({ type: "link.notice", node, text });
  },
});
