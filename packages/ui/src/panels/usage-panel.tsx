/**
 * @file The Usage panel: what runs spent over a period (specs/usage.md), for
 *   one project or all. The totals, spend over time, where it went, and what is
 *   worth a look. It reads the report again when a run ends. The filters live
 *   in the page's state, since a change of layout mounts the panel afresh.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { Select } from "../components/select.tsx";
import { useAppState } from "../state/context.tsx";
import { shownOf } from "../state/read.ts";
import { ALL_PROJECTS, baseName, projectOptions } from "./project-options.ts";
import { PERIODS, sinceOf, usageCommand } from "./usage-model.ts";
import { Report } from "./usage-report.tsx";
import { NothingSpent, Refused } from "./usage-tables.tsx";

import styles from "./usage.module.css";

export const UsagePanel = () => {
  const state = useAppState();
  const read = useValue(state.usage.state);
  const runs = useValue(state.runs);
  const projects = useValue(state.projects.state);
  const filter = useValue(state.usageFilter);
  const { project, period } = filter;
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
    const since = sinceOf(period, now);
    void state.usage.load({
      now,
      period,
      query: {
        ...(project === ALL_PROJECTS ? {} : { project }),
        ...(since === undefined ? {} : { since }),
      },
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `ended` and `attempt` are reasons to read again
  }, [state, project, period, ended, attempt]);
  const options = useMemo(
    () =>
      projectOptions(
        projects.status === "ready" ? projects.data : [],
        runs ?? [],
      ),
    [projects, runs],
  );
  const everyProject = project === ALL_PROJECTS;
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <div className={styles["projectFilter"]}>
          <Select
            label="Project"
            onChange={value => {
              void state.usageFilter.setValue({ ...filter, project: value });
            }}
            options={options}
            value={project}
          />
        </div>
        <Select
          label="Period"
          onChange={value => {
            void state.usageFilter.setValue({ ...filter, period: value });
          }}
          options={PERIODS}
          value={period}
        />
      </div>
      <section
        aria-busy={read.status === "loading"}
        aria-label="Usage report"
        className={styles["body"]}
        ref={body}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the keys scroll it
        tabIndex={0}
      >
        {read.status === "failed" ? (
          <Refused
            command={usageCommand(everyProject, period)}
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
          <NothingSpent period={shown.arg.period} />
        ) : (
          <Report
            everyProject={shown.arg.query.project === undefined}
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
