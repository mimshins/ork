/**
 * @file The Usage panel: what runs spent over a period (specs/usage.md), for
 *   one project or all. The totals, spend over time, where it went, and what is
 *   worth a look. It reads the report again when a run ends.
 */

import { useEffect, useMemo, useState } from "react";
import { useComputedValue, useValue } from "react-containerized-state";

import { EmptyState } from "../components/bits.tsx";
import { Select } from "../components/select.tsx";
import { useAppState } from "../state/context.tsx";
import { ALL_PROJECTS, projectOptions } from "./project-options.ts";
import { DEFAULT_PERIOD, PERIODS, sinceOf } from "./usage-model.ts";
import { Report } from "./usage-report.tsx";

import styles from "./usage.module.css";

export const UsagePanel = () => {
  const state = useAppState();
  const read = useValue(state.usage.state);
  const runs = useValue(state.runs);
  const projects = useValue(state.projects.state);
  const [project, setProject] = useState(ALL_PROJECTS);
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  // What was there stays on the page while the next one is read.
  const report =
    read.status === "ready"
      ? read.data
      : read.status === "loading"
        ? (read.previous ?? null)
        : null;
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
      query: {
        ...(project === ALL_PROJECTS ? {} : { project }),
        ...(since === undefined ? {} : { since }),
      },
    });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `ended` is the reason to read again
  }, [state, project, period, ended]);
  const options = useMemo(
    () =>
      projectOptions(
        projects.status === "ready" ? projects.data : [],
        runs ?? [],
      ),
    [projects, runs],
  );
  return (
    <div className={styles["panel"]}>
      <div className={styles["tools"]}>
        <Select
          label="Project"
          onChange={setProject}
          options={options}
          value={project}
        />
        <Select
          label="Period"
          onChange={setPeriod}
          options={PERIODS}
          value={period}
        />
      </div>
      <div className={styles["body"]}>
        {read.status === "failed" ? (
          <p
            className={styles["refused"]}
            role="alert"
          >
            Cannot read usage: {read.error}
          </p>
        ) : null}
        {report === null ? (
          read.status === "failed" ? null : (
            <p className={styles["note"]}>Reading usage…</p>
          )
        ) : report.totals.sessions === 0 ? (
          <EmptyState title="Nothing spent in this period">
            Claude sessions show here once they finish.
          </EmptyState>
        ) : (
          <Report
            everyProject={project === ALL_PROJECTS}
            projectName={root =>
              options.find(option => option.value === root)?.label ?? root
            }
            now={read.status === "idle" ? 0 : read.arg.now}
            report={report}
            since={read.status === "idle" ? undefined : read.arg.query.since}
          />
        )}
      </div>
    </div>
  );
};
