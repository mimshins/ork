/**
 * @file The Chats panel: one thread per leader or worker of the chosen run,
 *   built from its events, and the way to write to it. The node is the shared
 *   selection, so choosing one in the Monitor opens it here; with none chosen,
 *   or one with no session, it shows the first that has one. It reads the
 *   feed's tail while another panel holds the feed still, so replies keep
 *   arriving.
 */

import { useEffect, useMemo } from "react";
import { useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { Combobox } from "../components/combobox.tsx";
import { useAppState } from "../state/context.tsx";
import { ChatComposer } from "./chat-composer.tsx";
import { ChatThread } from "./chat-thread.tsx";
import { sessionNodes, threadOf } from "./chats-model.ts";
import type { RunView } from "./use-run-monitor.ts";

import styles from "./chats.module.css";

const RunChats = ({
  run,
  selected,
}: {
  run: RunView;
  selected: string | null;
}) => {
  const state = useAppState();
  const feed = useMemo(() => state.feedOf(run.id), [state, run.id]);
  useEffect(() => state.retainRun(run.id), [state, run.id]);
  const { events, tail, following, link } = useValue(feed.state);
  const shown = following ? events : tail;
  const nodes = useMemo(() => sessionNodes(events), [events]);
  const node =
    selected !== null && nodes.includes(selected)
      ? selected
      : (nodes[0] ?? null);
  const items = useMemo(
    () => (node === null ? [] : threadOf(shown, node)),
    [shown, node],
  );

  if (node === null) {
    return (
      <EmptyState
        title={
          link === "loading" && events.length === 0
            ? "Reading the run…"
            : "This run has no one to talk to."
        }
      >
        Only leaders and workers have sessions.
      </EmptyState>
    );
  }
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <Combobox
          empty="No node matches."
          label="Node"
          onChange={state.selectNode}
          options={nodes.map(value => ({ value, label: value }))}
          value={node}
        />
      </div>
      {items.length === 0 ? (
        <EmptyState title={`Nothing from ${node} yet.`}>
          What it says and what you write show here.
        </EmptyState>
      ) : (
        <ChatThread
          items={items}
          key={node}
          node={node}
        />
      )}
      <ChatComposer
        key={`${run.id}/${node}`}
        node={node}
        run={run}
      />
    </div>
  );
};

export const ChatsPanel = () => {
  const state = useAppState();
  const { run: runId, node } = useValue(state.selection);
  const runs = useValue(state.runs);
  const run = runs?.find(({ id }) => id === runId);
  return run === undefined ? (
    <EmptyState title="No run chosen.">
      Choose one in the Runs panel, or use{" "}
      <code>ork chat &lt;run&gt; &lt;node&gt;</code>.
    </EmptyState>
  ) : (
    <RunChats
      key={run.id}
      run={run}
      selected={node}
    />
  );
};
