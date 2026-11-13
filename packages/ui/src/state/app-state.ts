/**
 * @file The page's state, one container per concern, fed by the server's
 *   streams (ADR-024: the store is the truth, so a write goes through the
 *   client and comes back on a stream; nothing here updates optimistically).
 *   `runs`, `decisions` and `version` follow the overview stream (overview.ts);
 *   each run a panel looks at has its own feed (feeds.ts). What the user chose,
 *   a run and a node, is the shared selection, and the Context panel's target
 *   follows every choice. What the Builder has open is kept here too
 *   (builder-session.ts, made with the Context panel's target it tells), so it
 *   outlives the panel as the selection does.
 */

import type {
  BodyOf,
  Client,
  DecisionRecord,
  Health,
  QueryOf,
  RunView,
} from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import { createContextTarget } from "./context-target.ts";
import { createDecisionHistory } from "./decision-history.ts";
import { createFeeds, isLive } from "./feeds.ts";
import { createNotifications } from "./notifications.ts";
import { createOverview } from "./overview.ts";
import { createPreferences } from "./preferences.ts";
import { createRead } from "./read.ts";
import type { LinkStatus, OpenSource } from "./stream-link.ts";

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
  /** The Ork version the page was built for, when known. */
  pageVersion?: string | null;
};

export type AppState = ReturnType<typeof createAppState>;

/**
 * Whether `ork ui` cannot be reached now: the stream is lost or the health
 * check failed. Not while it is still connecting for the first time.
 */
export const isUnreachable = ({ link, server }: Connection): boolean =>
  link === "lost" || (server !== null && "error" in server);

/** What the status bar says about the server. */
export const describeConnection = (connection: Connection): string => {
  const { link, server } = connection;
  if (server !== null && "error" in server) {
    return `Cannot reach \`ork ui\`: ${server.error}`;
  }
  if (isUnreachable(connection)) {
    return "Lost the stream from `ork ui`. Retrying…";
  }
  return link === "open" && server !== null
    ? `Ork ${server.version}`
    : "Connecting to `ork ui`…";
};

export const liveRuns = (runs: readonly RunView[] | null): number | null =>
  runs === null ? null : runs.filter(run => isLive(run)).length;

export const createAppState = ({
  client,
  open,
  storage,
  pageVersion = null,
}: AppStateOptions) => {
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
  /** The Runs panel's filter bar values, for the page's life. */
  const runFilter = Container.create<Partial<Record<string, string>>>({});
  const runDialog = Container.create(false);
  /** What the Run workflow dialog opens on, when something chose for it. */
  const runPreset = Container.create<{
    project: string;
    workflow: string;
  } | null>(null);
  const projects = createRead(() => client.call("projects"));
  const triggers = createRead(() => client.call("triggers"));
  /** The filter fields of every list: the bars' one read. */
  const listFields = createRead(() => client.call("listFields"));
  const workflows = createRead((id: string) =>
    client.call("workflows", { params: { id } }),
  );
  /** The Usage panel's filters, which outlive a change of layout. */
  const usageFilter = Container.create<Partial<Record<string, string>>>({});
  /** `now` is when it was asked, which the report's chart runs up to. */
  const usage = createRead(
    ({ query }: { query: QueryOf<"usage">; now: number; period: string }) =>
      client.call("usage", { query }),
  );
  /**
   * The Feedback panel's filters, for the page's life: the bar's values (no
   * status means not dismissed) and the About select beside it.
   */
  const feedbackFilter = Container.create<{
    values: Partial<Record<string, string>>;
    about: string;
  }>({ values: {}, about: "all" });
  /** The items the bar's query leaves (`filterQuery`); no stream sends them. */
  const feedback = createRead((query: Record<string, string>) =>
    client.call("feedbackItems", { query }),
  );
  /** The Worktrees panel's filter bar values, for the page's life. */
  const worktreesFilter = Container.create<Partial<Record<string, string>>>({});
  /** What `ork worktrees` lists under the bar's query: no stream sends it. */
  const worktrees = createRead((query: Record<string, string>) =>
    client.call("worktrees", { query }),
  );
  const feeds = createFeeds({ client, open });
  const decisionHistory = createDecisionHistory(client);
  const notifications = createNotifications({ runs, decisions, storage });
  const overview = createOverview({
    client,
    open,
    pageVersion,
    runs,
    decisions,
  });
  const { version, followUps, followUpsFilter, followUpsDue } = overview;

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
    /** The Builder's open workflow, its selection and its undo history. */
    builder: context.builder,
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
    followUps,
    followUpsFilter,
    followUpsDue,
    worktrees,
    worktreesFilter,
    triggers,
    listFields,
    version,
    /** Asks for a run; it then arrives on the stream like any other. */
    startRun: (body: BodyOf<"start">) => client.call("start", { body }),
    /** Follows the server until the returned function is called. */
    start: (): (() => void) => {
      const stopWatching = runs.subscribe(feeds.reopenResumed);
      const stopSettling = decisions.subscribe(decisionHistory.saw);
      const stopNotifying = notifications.start();
      const link = overview.follow({
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
    /**
     * Answers a decision, with the person's note when they wrote one; it then
     * leaves the open list on the stream.
     */
    answerDecision: (id: string, choose: string, note = "") =>
      client.call("answer", {
        params: { id },
        body: note.trim() === "" ? { choose } : { choose, note },
      }),
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
