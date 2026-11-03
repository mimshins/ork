/**
 * @file A usage report as the Usage panel draws it: totals, what is worth a
 *   look, spend over time, and where it went.
 */

import type { UsageReport } from "@krapht/ork-server/client";
import { useMemo } from "react";

import { UsageChart } from "./usage-chart.tsx";
import { seriesOf } from "./usage-model.ts";
import { Breakdown, Totals } from "./usage-tables.tsx";

import styles from "./usage.module.css";

export const Report = ({
  report,
  since,
  now,
  everyProject,
  projectName,
}: {
  report: UsageReport;
  since: string | undefined;
  now: number;
  everyProject: boolean;
  projectName: (root: string) => string;
}) => {
  const series = useMemo(
    () => seriesOf(report, since, now),
    [report, since, now],
  );
  const total = report.totals.costUsd;
  return (
    <>
      <Totals report={report} />
      {report.hints.length === 0 ? null : (
        <section
          aria-label="Worth a look"
          className={styles["section"]}
        >
          <h3 className={styles["heading"]}>Worth a look</h3>
          <ul className={styles["hints"]}>
            {report.hints.map(hint => (
              <li key={hint.code}>{hint.message}</li>
            ))}
          </ul>
        </section>
      )}
      <UsageChart series={series} />
      {everyProject ? (
        <Breakdown
          groups={report.groups.project}
          label="Project"
          nameOf={projectName}
          title="By project"
          total={total}
        />
      ) : null}
      <Breakdown
        groups={report.groups.workflow}
        label="Workflow"
        title="By workflow"
        total={total}
      />
      <Breakdown
        groups={report.groups.model}
        label="Model"
        title="By model"
        total={total}
      />
      <Breakdown
        groups={report.groups.node}
        label="Node"
        title="Costliest nodes"
        total={total}
      />
      <p className={styles["note"]}>
        Costs are Claude Code&apos;s own estimates. On a subscription they are
        not what you are billed.
      </p>
    </>
  );
};
