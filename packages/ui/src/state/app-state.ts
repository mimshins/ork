/**
 * @file The page's state, one container per concern, fed by the server's
 *   streams (ADR-024: the store is the truth, so a write goes through the
 *   client and comes back on a stream; nothing here updates optimistically).
 *   `runs` and `decisions` follow the overview stream; each run a panel looks
 *   at has its own feed (feeds.ts). What the user chose, a run and a node, is
 *   the shared selection, and the Context panel's target follows every choice.
 */

import {
  type BodyOf,
  type Client,
  type DecisionRecord,
  type Health,
  type OverviewEvents,
  type QueryOf,
  type RunView,
  STREAMS,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import { createContextTarget } from "./context-target.ts";
import { createDecisionHistory } from "./decision-history.ts";
import { createFeeds, isLive } from "./feeds.ts";
import { createNotifications } from "./notifications.ts";
import {
  ALL_PROJECTS,
  createPreferences,
  DEFAULT_PERIOD,
} from "./preferences.ts";
import { createRead } from "./read.ts";
import { reconcile } from "./reconcile.ts";
import { type LinkStatus, type OpenSource, openLink } from "./stream-link.ts";

export type Connection = {
  link: LinkStatus;
  /** What `/api/health` last said; null until it answers. */
  server: Health | { error: string } | null;
};

export type Selection = { run: string | null; node: string | null };

export type AppStateOptions = {
  client: Client;
  open: OpenSource;
  storage: Storage;
};

export type AppState = ReturnType<typeof createAppState>;

/** What the status bar says about the server. */
export const describeConnection = ({ link, server }: Connection): string => {
  if (server !== null && "error" in server) {
    return `Cannot reach \`ork ui\`: ${server.error}`;
  }
  if (link === "lost") return "Lost the stream from `ork ui`. Retrying…";
  return link === "open" && server !== null
    ? `Ork ${server.version}`
    : "Connecting to `ork ui`…";
};

export const liveRuns = (runs: readonly RunView[] | null): number | null =>
  runs === null ? null : runs.filter(run => isLive(run)).length;

export const createAppState = ({ client, open, storage }: AppStateOptions) => {
  const runs = Container.create<readonly RunView[] | null>(null);
  const decisions = Container.create<readonly DecisionRecord[] | null>(null);
  const connection = Container.create<Connection>({
    link: "connecting",
    server: null,
  });
  const selection = Container.create<Selection>({ run: null, node: null });
  const context = createContextTarget();
  /** The run the focus goes to once the Monitor shows it. */
  let arriving: string | null = null;
  /**
   * Every choice of a run or node is a choice for the Context panel too. A
   * choice of another run ends a wait for one to arrive, so a run shown later
   * never takes the focus it wasn't asked to.
   */
  const chooseNode = (next: Selection): void => {
    if (next.run !== arriving) arriving = null;
    void selection.setValue(next);
    context.chooseRun(next.run, next.node);
  };
  const preferences = createPreferences(storage);
  /** The project the Runs panel shows: a root, or "all". */
  const runFilter = Container.create(ALL_PROJECTS);
  const runDialog = Container.create(false);
  /** What the Run workflow dialog opens on, when something chose for it. */
  const runPreset = Container.create<{
    project: string;
    workflow: string;
  } | null>(null);
  const projects = createRead(() => client.call("projects"));
  const triggers = createRead(() => client.call("triggers"));
  const workflows = createRead((id: string) =>
    client.call("workflows", { params: { id } }),
  );
  /** The Usage panel's filters, which outlive a change of layout. */
  const usageFilter = Container.create({
    project: ALL_PROJECTS,
    period: DEFAULT_PERIOD,
  });
  /** `now` is when it was asked, which the report's chart runs up to. */
  const usage = createRead(
    ({ query }: { query: QueryOf<"usage">; now: number; period: string }) =>
      client.call("usage", { query }),
  );
  /** The Feedback panel's filters, for the page's life. */
  const feedbackFilter = Container.create({ status: "open", about: "all" });
  /** Every feedback item, dismissed ones too: no stream sends them. */
  const feedback = createRead(() => client.call("feedbackItems"));
  const feeds = createFeeds({ client, open });
  const decisionHistory = createDecisionHistory(client);
  const notifications = createNotifications({ runs, decisions, storage });

  const askServer = async (): Promise<void> => {
    const answer = await client.call("health");
    void connection.setValue({
      ...connection.getValue(),
      server: answer.ok ? answer.data : { error: answer.error },
    });
  };

  return {
    runs,
    decisions,
    connection,
    selection,
    /** The node the Context panel shows: the latest chosen, anywhere. */
    contextTarget: context.target,
    chooseBuilderNode: context.chooseBuilder,
    builderChanged: context.builderChanged,
    builderClosed: context.builderClosed,
    preferences,
    runFilter,
    runDialog,
    runPreset,
    client,
    settledDecisions: decisionHistory.settled,
    notifications,
    projects,
    workflows,
    usage,
    usageFilter,
    feedback,
    feedbackFilter,
    triggers,
    /** Asks for a run; it then arrives on the stream like any other. */
    startRun: (body: BodyOf<"start">) => client.call("start", { body }),
    /** Follows the server until the returned function is called. */
    start: (): (() => void) => {
      const stopWatching = runs.subscribe(feeds.reopenResumed);
      const stopSettling = decisions.subscribe(decisionHistory.saw);
      const stopNotifying = notifications.start();
      const link = openLink<OverviewEvents>({
        url: () => STREAMS.overview,
        open,
        on: {
          runs: next => {
            void runs.setValue(reconcile(runs.getValue(), next));
          },
          decisions: next => {
            void decisions.setValue(reconcile(decisions.getValue(), next));
          },
        },
        onStatus: status => {
          void connection.setValue({ ...connection.getValue(), link: status });
          if (status !== "lost") void askServer();
        },
        onFailure: () => void askServer(),
      });
      return () => {
        stopWatching();
        stopSettling();
        stopNotifying();
        link.close();
      };
    },
    /** A run's feed, which holds its events only while retained. */
    feedOf: feeds.feedOf,
    /** Reads the run until the returned function is called. */
    retainRun: feeds.retainRun,
    /** Pause, continue or stop: the answer comes back on the run's stream. */
    control: (
      kind: "pause" | "continue" | "stop",
      runId: string,
      node?: string,
    ) =>
      client.call(kind, {
        params: { id: runId },
        body: node === undefined ? {} : { node },
      }),
    /** Writes to a node of a live run; it comes back on the run's stream. */
    sendMessage: (runId: string, node: string, body: string) =>
      client.call("message", { params: { id: runId }, body: { node, body } }),
    /** Answers a decision; it then leaves the open list on the stream. */
    answerDecision: (id: string, choose: string) =>
      client.call("answer", { params: { id }, body: { choose } }),
    /** What the Monitor shows of a run, read while it is started. */
    watchRun: feeds.watchRun,
    selectRun: (run: string | null): void => {
      arriving = null;
      chooseNode({ run, node: null });
    },
    /** Chooses a run for the focus to follow, since what opened it may go. */
    arriveAt: (run: string): void => {
      arriving = run;
      chooseNode({ run, node: null });
    },
    /** Whether the focus should go to this run, now it shows: asking clears it. */
    takeArrival: (run: string): boolean => {
      const arrived = arriving === run;
      if (arrived) arriving = null;
      return arrived;
    },
    selectNode: (node: string | null): void => {
      chooseNode({ ...selection.getValue(), node });
    },
  };
};
