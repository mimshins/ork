/**
 * @file The overview stream the page follows (specs/ui/state.md): the runs and
 *   the open decisions, each kept as the same objects when nothing in them
 *   changed, and what is known of Ork's versions, which feeds the new-version
 *   banner. The status of the link goes to whoever follows it.
 */

import {
  type Client,
  type DecisionRecord,
  type FollowUpsDue,
  type OverviewEvents,
  type OverviewFollowUpEvents,
  type RunView,
  STREAMS,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import type { FilterValues } from "../components/filter-model.ts";
import {
  createFollowUpsFilter,
  NONE_DUE,
  readFollowUps,
} from "./follow-ups.ts";
import { createRead } from "./read.ts";
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
  /** The due follow-ups the stream sends, for the tab's count. */
  const followUpsDue = Container.create<FollowUpsDue>(NONE_DUE);
  return {
    version,
    followUpsDue,
    /**
     * Every project's follow-ups under the panel's filter: only the due count
     * streams.
     */
    followUps: createRead((filter: FilterValues) =>
      readFollowUps(client, filter),
    ),
    followUpsFilter: createFollowUpsFilter(),
    /** Follows the stream until the link is closed. */
    follow: (handlers: {
      onStatus: (status: LinkStatus) => void;
      onFailure: () => void;
    }): StreamLink =>
      openLink<OverviewEvents & OverviewFollowUpEvents>({
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
          followUps: next => {
            void followUpsDue.setValue(next);
          },
        },
        ...handlers,
      }),
  };
};
