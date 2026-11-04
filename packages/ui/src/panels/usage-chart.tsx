/**
 * @file The Usage panel's one chart: what was spent per day or week, as bars on
 *   a single axis. A line above it says what the pointer is on, or the peak,
 *   and a table a keyboard and a screen reader can read has the days with spend
 *   in it. The last bar is a day or week still going, so it is drawn apart.
 */

import { useState } from "react";

import { type Bar, money, moneyOf, type Series } from "./usage-model.ts";

import styles from "./usage.module.css";

const peakOf = (bars: readonly Bar[]): Bar | undefined =>
  bars.toSorted((a, b) => b.costUsd - a.costUsd)[0];

const sessionsOf = (count: number): string =>
  `${String(count)} session${count === 1 ? "" : "s"}`;

/** At the least this much of the height, so a small spend still shows. */
const MIN_HEIGHT = 2;

/** This few columns always have room for a date under each. */
const LABELS_FIT = 6;

/** This few have room once the panel is wide. */
const LABELS_FIT_WIDE = 14;

/** Which columns get a date of their own: see `.axisEvery`. */
const labelledOf = (count: number): "always" | "wide" | "never" => {
  if (count <= LABELS_FIT) return "always";
  return count <= LABELS_FIT_WIDE ? "wide" : "never";
};

const Axis = ({ bars }: { bars: readonly Bar[] }) => {
  const labelled = labelledOf(bars.length);
  return (
    <>
      <div
        aria-hidden
        className={styles["axis"]}
        data-labelled={labelled}
      >
        <span>{bars[0]?.key}</span>
        <span>{bars.at(-1)?.key}</span>
      </div>
      <div
        aria-hidden
        className={styles["axisEvery"]}
        data-labelled={labelled}
      >
        {bars.map(bar => (
          <span key={bar.key}>{bar.key.slice("2026-".length)}</span>
        ))}
      </div>
    </>
  );
};

/** The numbers: only what was spent, newest first, and how much of it is idle. */
const ChartTable = ({ series }: { series: Series }) => {
  const { bars, unit } = series;
  const spent = bars
    .filter(bar => bar.costUsd > 0 || bar.sessions > 0)
    .toReversed();
  const idle = bars.length - spent.length;
  const cost = moneyOf(spent.map(bar => bar.costUsd));
  return (
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
          {spent.map(bar => (
            <tr key={bar.key}>
              <th
                className={styles["name"]}
                scope="row"
              >
                {bar.key}
              </th>
              <td className={styles["number"]}>{cost(bar.costUsd)}</td>
              <td className={styles["number"]}>{bar.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {idle === 0 ? null : (
        <p className={styles["note"]}>
          {String(idle)} {unit}
          {idle === 1 ? "" : "s"} with no spend.
        </p>
      )}
    </details>
  );
};

export const UsageChart = ({ series }: { series: Series }) => {
  const [pointedKey, setPointedKey] = useState<string | null>(null);
  const { bars, maxUsd, unit } = series;
  // By its key: a report read again has that bar's new numbers.
  const pointed = bars.find(bar => bar.key === pointedKey) ?? null;
  const peak = peakOf(bars);
  const shown = pointed ?? peak;
  const last = bars.at(-1)?.key;
  const heading = unit === "day" ? "Spend per day" : "Spend per week";
  const when = unit === "day" ? "" : "week of ";
  const summary =
    peak === undefined
      ? heading
      : `${heading}, ${String(bars.length)} ${unit}s. The peak was ${money(peak.costUsd)} ${unit === "day" ? "on" : "in the week of"} ${peak.key}.`;
  return (
    <section
      aria-label={heading}
      className={styles["section"]}
    >
      <div className={styles["chartHead"]}>
        <h3 className={styles["heading"]}>{heading}</h3>
        {shown === undefined ? null : (
          <p className={styles["readout"]}>
            {pointed === null ? "Peak: " : ""}
            {when}
            {shown.key}
            {shown.key === last ? " so far" : ""} · {money(shown.costUsd)} ·{" "}
            {sessionsOf(shown.sessions)}
          </p>
        )}
      </div>
      <div
        aria-label={summary}
        className={styles["chart"]}
        onPointerLeave={() => {
          setPointedKey(null);
        }}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- bars drawn in CSS, read as one picture; the table below has the numbers
        role="img"
      >
        {bars.map(bar => (
          // The whole column answers the pointer, not just the bar in it.
          <div
            className={styles["column"]}
            data-partial={bar.key === last ? "" : undefined}
            data-pointed={bar.key === pointed?.key ? "" : undefined}
            key={bar.key}
            onPointerEnter={() => {
              setPointedKey(bar.key);
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
      <Axis bars={bars} />
      <ChartTable series={series} />
    </section>
  );
};
