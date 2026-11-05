/**
 * @file A usage report as the Usage panel draws it: totals, what is worth a
 *   look, spend over time, and where it went.
 */

import type { UsageAnswer } from "@krapht/ork-server/client";
import { useMemo } from "react";

import { CodeText } from "../components/code-text.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { UsageChart } from "./usage-chart.tsx";
import { UsageLimits } from "./usage-limits.tsx";
import { seriesOf, usageCommand } from "./usage-model.ts";
import { Breakdown, Totals } from "./usage-tables.tsx";

import styles from "./usage.module.css";

export const Report = ({
  report,
  since,
  now,
  period,
  everyProject,
  projectName,
}: {
  report: UsageAnswer;
  since: string | undefined;
  now: number;
  /** The period chosen, for the commands that show the same on a terminal. */
  period: string;
  everyProject: boolean;
  projectName: (root: string) => string;
}) => {
  const series = useMemo(
    () => seriesOf(report, since, now),
    [report, since, now],
  );
  const total = report.totals.costUsd;
  const command = (by?: string) => usageCommand(everyProject, period, by);
  return (
    <>
      <UsageLimits limits={report.limits} />
      <div className={styles["overview"]}>
        <Totals report={report} />
        {report.hints.length === 0 ? null : (
          <section
            aria-label="Worth a look"
            className={styles["hintsSection"]}
          >
            <h3 className={styles["heading"]}>Worth a look</h3>
            <ul className={styles["hints"]}>
              {report.hints.map(hint => (
                <li key={hint.code}>
                  <CodeText text={hint.message} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className={styles["chartArea"]}>
          <UsageChart series={series} />
        </div>
      </div>
      <div className={styles["breakdowns"]}>
        {everyProject ? (
          <Breakdown
            groups={report.groups.project}
            label="Project"
            moreCommand={command("project")}
            nameOf={projectName}
            title="By project"
            total={total}
          />
        ) : null}
        <Breakdown
          groups={report.groups.workflow}
          label="Workflow"
          moreCommand={command("workflow")}
          title="By workflow"
          total={total}
        />
        <Breakdown
          groups={report.groups.model}
          label="Model"
          moreCommand={command("model")}
          title="By model"
          total={total}
        />
        <Breakdown
          groups={report.groups.node}
          label="Node"
          moreCommand={command("node")}
          title="Costliest nodes"
          total={total}
        />
      </div>
      <p className={styles["note"]}>
        Costs are Claude Code&apos;s own estimates. On a subscription they are
        not what you are billed. On a terminal:
      </p>
      <CopyCommand command={command()} />
    </>
  );
};
