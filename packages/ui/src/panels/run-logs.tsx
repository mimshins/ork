/**
 * @file One run in the Logs panel: its events read for as long as it shows, the
 *   filters over them, and what is left of them, said aloud once typing stops.
 */

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { useAppState } from "../state/context.tsx";
import { WorkspaceContext } from "../workspace/context.ts";
import { LogFiltersBar } from "./log-filters.tsx";
import { LogList } from "./log-list.tsx";
import { LogStatus } from "./log-status.tsx";
import { countsLine, filterEvents, logsCommand } from "./logs-model.ts";
import { useLogScroll } from "./use-log-scroll.ts";

import styles from "./logs.module.css";

/** How long the filters stay still before what they leave is said. */
const SETTLE_MS = 500;

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

  const workspace = use(WorkspaceContext);
  const filters = JSON.stringify([node, type, text]);
  const said = useRef(filters);
  const counts = countsLine(shown.length, events.events.length, events.latest);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (filters === said.current) return;
      said.current = filters;
      workspace?.announce(counts);
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [filters, counts, workspace]);

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
      <div className={styles["main"]}>
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
    </div>
  );
};
