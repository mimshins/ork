/**
 * @file The cost and token meter, on Base UI's: a labeled bar with the value
 *   always in words, so it reads without the bar. Near its limit the bar turns
 *   to the attention color; the words still say how much.
 */

import { Meter as BaseMeter } from "@base-ui/react/meter";

import styles from "./meter.module.css";

const HIGH = 0.8;

export type MeterProps = {
  /** What it measures: "Budget". */
  label: string;
  value: number;
  max: number;
  /** The value in words: "$1.42 of $2.00". */
  text: string;
};

export const Meter = ({ label, value, max, text }: MeterProps) => (
  <BaseMeter.Root
    aria-valuetext={text}
    className={styles["meter"]}
    data-level={value >= max * HIGH ? "high" : "normal"}
    max={max}
    value={Math.min(value, max)}
  >
    <BaseMeter.Label className={styles["label"]}>{label}</BaseMeter.Label>
    <span className={styles["value"]}>{text}</span>
    <BaseMeter.Track className={styles["track"]}>
      <BaseMeter.Indicator className={styles["fill"]} />
    </BaseMeter.Track>
  </BaseMeter.Root>
);
