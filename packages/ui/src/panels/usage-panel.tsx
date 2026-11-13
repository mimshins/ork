/**
 * @file The Usage panel: what runs spent over a period (specs/usage.md), for
 *   one project or all, narrowed by the shared filter bar
 *   (specs/ui/design-filter-bar.md). The totals, spend over time, where it
 *   went, and what is worth a look. It reads the report again when a run ends.
 *   The filter lives in the page's state, since a change of layout mounts the
 *   panel afresh; `since` starts at 30 days, as the CLI's does.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { FilterBar } from "../components/filter-bar.tsx";
import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { ALL_PROJECTS, baseName, projectOptions } from "./project-options.ts";
import { NothingSpent, Refused } from "./usage-empty.tsx";
import { DEFAULT_SINCE, sinceQuery, usageCommand } from "./usage-model.ts";
import { Report } from "./usage-report.tsx";

import styles from "./usage.module.css";

export const UsagePanel = () => {
  const state = useAppState();
  const read = useValue(state.usage.state);
  const runs = useValue(state.runs);
  const projects = useValue(state.projects.state);
  const values = useValue(state.usageFilter);
  const since = values["since"] ?? DEFAULT_SINCE;
  const { project, workflow, until } = values;
  const [attempt, setAttempt] = useState(0);
  // What was there stays on the page, with what it was read for, meanwhile.
  const shown = shownOf(read);
  const body = useRef<HTMLElement>(null);
  // A run that ends has spent: the report is read again.
  const ended = useComputedValue(
    state.runs,
    list =>
      list?.filter(run => run.live !== "running" && run.live !== "paused")
        .length ?? 0,
  );
  useEffect(() => {
    void state.projects.load();
  }, [state]);
  useEffect(() => {
    const now = Date.now();
    const start = sinceQuery(since, now);
    void state.usage.load({
      now,
      period: since,
      query: {
        ...(project === undefined ? {} : { project }),
        ...(workflow === undefined ? {} : { workflow }),
        ...(start === undefined ? {} : { since: start }),
        ...(until === undefined ? {} : { until }),
      },
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `ended` and `attempt` are reasons to read again
  }, [state, project, workflow, since, until, ended, attempt]);
  const options = useMemo(
    () =>
      projectOptions(
        projects.status === "ready" ? projects.data : [],
        runs ?? [],
      ),
    [projects, runs],
  );
  const suggestions = useMemo(
    () => options.filter(option => option.value !== ALL_PROJECTS),
    [options],
  );
  const everyProject = project === undefined || project === ALL_PROJECTS;
  const refused = read.status === "failed" && read.code === 400;
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <div className={styles["filter"]}>
          <FilterBar
            busy={read.status === "loading"}
            defaults={{ since: DEFAULT_SINCE }}
            error={
              read.status === "failed" && refused
                ? { message: read.error }
                : null
            }
            list="usage"
            onChange={next => {
              void state.usageFilter.setValue(next);
            }}
            shown={shown?.data.totals.sessions ?? null}
            suggestions={{ project: suggestions }}
            values={values}
          />
        </div>
      </div>
      <section
        aria-busy={read.status === "loading"}
        aria-label="Usage report"
        className={styles["body"]}
        ref={body}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys scroll it
        tabIndex={0}
      >
        {read.status === "failed" && !refused ? (
          <Refused
            command={usageCommand(everyProject, since)}
            error={read.error}
            retry={() => {
              // The button goes while it reads: the keys stay in the panel.
              body.current?.focus();
              setAttempt(attempt + 1);
            }}
          />
        ) : null}
        {shown === undefined ? (
          read.status === "failed" ? null : (
            <p className={styles["note"]}>Reading usage…</p>
          )
        ) : shown.data.totals.sessions === 0 ? (
          <NothingSpent
            limits={shown.data.limits}
            onClear={() => {
              void state.usageFilter.setValue({});
            }}
            period={shown.arg.period}
            values={values}
          />
        ) : (
          <Report
            everyProject={
              shown.arg.query.project === undefined ||
              shown.arg.query.project === ALL_PROJECTS
            }
            now={shown.arg.now}
            period={shown.arg.period}
            projectName={root =>
              options.find(option => option.value === root)?.label ??
              baseName(root)
            }
            report={shown.data}
            since={shown.arg.query.since}
          />
        )}
      </section>
    </div>
  );
};
