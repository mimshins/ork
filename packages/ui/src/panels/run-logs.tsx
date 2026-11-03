/**
 * @file One run in the Logs panel: its events read for as long as it shows, the
 *   filters over them, and what is left of them.
 */

import { useEffect, useMemo, useState } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { LogFiltersBar } from "./log-filters.tsx";
import { LogList } from "./log-list.tsx";
import { LogStatus } from "./log-status.tsx";
import { filterEvents, logsCommand } from "./logs-model.ts";
import { useLogScroll } from "./use-log-scroll.ts";

import styles from "./logs.module.css";

export const RunLogs = ({
  runId,
  node,
}: {
  runId: string;
  node: string | null;
}) => {
  const state = useAppState();
  const feed = useMemo(() => state.feedOf(runId), [state, runId]);
  useEffect(() => state.retainRun(runId), [state, runId]);
  const events = useValue(feed.state);
  const [type, setType] = useState<string | null>(null);
  const [text, setText] = useState("");
  const shown = useMemo(
    () => filterEvents(events.events, { node, type, text }),
    [events.events, node, type, text],
  );
  const { listRef, onScroll } = useLogScroll(feed, events);

  return (
    <div className={styles["panel"]}>
      <LogFiltersBar
        events={events.events}
        node={node}
        onNode={state.selectNode}
        onText={setText}
        onType={setType}
        text={text}
        type={type}
      />
      <LogStatus
        cli={logsCommand(runId, node)}
        events={events}
        feed={feed}
        shown={shown.length}
      />
      {events.error === null ? null : (
        <p
          className={styles["error"]}
          role="alert"
        >
          {events.error}
        </p>
      )}
      <LogList
        label={`Events of run ${runId}`}
        listRef={listRef}
        onScroll={onScroll}
        reading={events.link === "loading" && events.events.length === 0}
        shown={shown}
      />
    </div>
  );
};
