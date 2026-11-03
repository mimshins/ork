/**
 * @file The Usage panel's numbers: the totals across its top, and a table of
 *   where the spend went by one dimension.
 */

import type { UsageReport } from "@krapht/ork-server/client";

import { money, percent, tokens } from "./usage-model.ts";

import styles from "./usage.module.css";

type Group = UsageReport["groups"]["workflow"][number];

/** How many rows a breakdown shows before it says how many more there are. */
const MOST_ROWS = 10;

export const Breakdown = ({
  title,
  label,
  groups,
  total,
  nameOf,
}: {
  title: string;
  label: string;
  groups: readonly Group[];
  total: number;
  /** What a group's key reads as; the key itself is its tooltip. */
  nameOf?: (key: string) => string;
}) => {
  const more = groups.length - MOST_ROWS;
  return (
    <section
      aria-label={title}
      className={styles["section"]}
    >
      <h3 className={styles["heading"]}>{title}</h3>
      <table className={styles["table"]}>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Cost
            </th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Share
            </th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Sessions
            </th>
            <th
              className={styles["number"]}
              scope="col"
            >
              Cache
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.slice(0, MOST_ROWS).map(group => (
            <tr key={group.key}>
              <th
                className={styles["name"]}
                scope="row"
                title={group.key}
              >
                {nameOf?.(group.key) ?? group.key}
              </th>
              <td className={styles["number"]}>{money(group.costUsd)}</td>
              <td className={styles["number"]}>
                {percent(total === 0 ? 0 : group.costUsd / total)}
              </td>
              <td className={styles["number"]}>{group.sessions}</td>
              <td className={styles["number"]}>
                {percent(group.cacheHitRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 ? (
        <p className={styles["note"]}>And {more} more that cost less.</p>
      ) : null}
    </section>
  );
};

export const Totals = ({ report }: { report: UsageReport }) => {
  const { totals } = report;
  const read =
    totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const items: readonly (readonly [string, string])[] = [
    ["Spend", money(totals.costUsd)],
    ["Runs", String(totals.runs)],
    ["Sessions", String(totals.sessions)],
    ["Tokens in", tokens(read)],
    ["Tokens out", tokens(totals.outputTokens)],
    ["From cache", percent(totals.cacheHitRate)],
  ];
  return (
    <dl className={styles["totals"]}>
      {items.map(([term, value]) => (
        <div
          className={styles["total"]}
          key={term}
        >
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};
