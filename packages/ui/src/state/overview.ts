/**
 * @file The overview stream the page follows (specs/ui/state.md): the runs and
 *   the open decisions, each kept as the same objects when nothing in them
 *   changed, and what is known of Ork's versions, which feeds the new-version
 *   banner. The status of the link goes to whoever follows it.
 */

import {
  type Client,
  type DecisionRecord,
  type OverviewEvents,
  type RunView,
  STREAMS,
} from "@krapht/ork-server/client";
import type { Container } from "react-containerized-state";

import { reconcile } from "./reconcile.ts";
import {
  type LinkStatus,
  type OpenSource,
  openLink,
  type StreamLink,
} from "./stream-link.ts";
import { createVersion } from "./version.ts";

export const createOverview = ({
  client,
  open,
  pageVersion,
  runs,
  decisions,
}: {
  client: Client;
  open: OpenSource;
  pageVersion: string | null;
  runs: Container<readonly RunView[] | null>;
  decisions: Container<readonly DecisionRecord[] | null>;
}) => {
  const version = createVersion({ client, open, pageVersion });
  return {
    version,
    /** Follows the stream until the link is closed. */
    follow: (handlers: {
      onStatus: (status: LinkStatus) => void;
      onFailure: () => void;
    }): StreamLink =>
      openLink<OverviewEvents>({
        url: () => STREAMS.overview,
        open,
        on: {
          runs: next => {
            void runs.setValue(reconcile(runs.getValue(), next));
          },
          decisions: next => {
            void decisions.setValue(reconcile(decisions.getValue(), next));
          },
          version: version.receive,
        },
        ...handlers,
      }),
  };
};
