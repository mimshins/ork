/**
 * @file The Usage panel's one chart: what was spent per day or week, as bars on
 *   a single axis. A line above it says what the pointer is on, or the peak,
 *   and the same numbers are a table a keyboard and a screen reader can read.
 */

import { useState } from "react";

import { type Bar, money, type Series } from "./usage-model.ts";

import styles from "./usage.module.css";

const peakOf = (bars: readonly Bar[]): Bar | undefined =>
  bars.toSorted((a, b) => b.costUsd - a.costUsd)[0];

const sessionsOf = (count: number): string =>
  `${String(count)} session${count === 1 ? "" : "s"}`;

/** At the least this much of the height, so a small spend still shows. */
const MIN_HEIGHT = 2;

export const UsageChart = ({ series }: { series: Series }) => {
  const [pointed, setPointed] = useState<Bar | null>(null);
  const { bars, maxUsd, unit } = series;
  const peak = peakOf(bars);
  const shown = pointed ?? peak;
  const heading = unit === "day" ? "Spend per day" : "Spend per week";
  const when = unit === "day" ? "" : "week of ";
  const summary =
    peak === undefined
      ? heading
      : `${heading}, ${String(bars.length)} ${unit}s. The most was ${money(peak.costUsd)} ${unit === "day" ? "on" : "in the week of"} ${peak.key}.`;
  return (
    <section
      aria-label={heading}
      className={styles["section"]}
    >
      <div className={styles["chartHead"]}>
        <h3 className={styles["heading"]}>{heading}</h3>
        {shown === undefined ? null : (
          <p className={styles["readout"]}>
            {pointed === null ? "Most: " : ""}
            {when}
            {shown.key} · {money(shown.costUsd)} · {sessionsOf(shown.sessions)}
          </p>
        )}
      </div>
      <div
        aria-label={summary}
        className={styles["chart"]}
        onPointerLeave={() => {
          setPointed(null);
        }}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- bars drawn in CSS, read as one picture; the table below has the numbers
        role="img"
      >
        {bars.map(bar => (
          // The whole column answers the pointer, not just the bar in it.
          <div
            className={styles["column"]}
            data-pointed={bar.key === pointed?.key ? "" : undefined}
            key={bar.key}
            onPointerEnter={() => {
              setPointed(bar);
            }}
          >
            {bar.costUsd === 0 ? null : (
              <div
                className={styles["bar"]}
                style={{
                  height: `${String(Math.max(MIN_HEIGHT, (bar.costUsd / maxUsd) * 100))}%`,
                }}
              />
            )}
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className={styles["axis"]}
      >
        <span>{bars[0]?.key}</span>
        <span>{bars.at(-1)?.key}</span>
      </div>
      <details className={styles["details"]}>
        <summary>Show as a table</summary>
        <table className={styles["table"]}>
          <thead>
            <tr>
              <th scope="col">{unit === "day" ? "Day" : "Week of"}</th>
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
                Sessions
              </th>
            </tr>
          </thead>
          <tbody>
            {bars.map(bar => (
              <tr key={bar.key}>
                <th
                  className={styles["name"]}
                  scope="row"
                >
                  {bar.key}
                </th>
                <td className={styles["number"]}>{money(bar.costUsd)}</td>
                <td className={styles["number"]}>{bar.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
};
