/**
 * @file The cost and token meter, on Base UI's: a labeled row of blocks with
 *   the value always in words, so it reads without them. Near its limit the
 *   blocks turn to the attention color and at it to danger; the words still say
 *   how much.
 */

import { Meter as BaseMeter } from "@base-ui/react/meter";

import styles from "./meter.module.css";

const HIGH = 0.8;
const BLOCKS = 20;

const BLOCK_KEYS = Array.from({ length: BLOCKS }, (_, block) => block);

export type MeterProps = {
  /** What it measures: "Budget". */
  label: string;
  value: number;
  max: number;
  /** The value in words: "$1.42 of $2.00". */
  text: string;
};

/**
 * How many blocks to fill. Anything spent shows a block, and only the limit
 * itself fills them all, so a full row always means full.
 */
export const blocksOn = (value: number, max: number): number => {
  if (value >= max) return BLOCKS;
  if (value <= 0) return 0;
  return Math.min(Math.max(Math.round((value / max) * BLOCKS), 1), BLOCKS - 1);
};

const levelOf = (value: number, max: number): string => {
  if (value >= max) return "full";
  return value >= max * HIGH ? "high" : "normal";
};

export const Meter = ({ label, value, max, text }: MeterProps) => {
  const on = blocksOn(value, max);
  return (
    <BaseMeter.Root
      aria-valuetext={text}
      className={styles["meter"]}
      data-level={levelOf(value, max)}
      max={max}
      value={Math.min(value, max)}
    >
      <BaseMeter.Label className={styles["label"]}>{label}</BaseMeter.Label>
      <span className={styles["value"]}>{text}</span>
      <BaseMeter.Track
        aria-hidden="true"
        className={styles["track"]}
      >
        {BLOCK_KEYS.map(block => (
          <span
            className={styles["block"]}
            data-on={block < on ? "" : undefined}
            key={block}
          />
        ))}
      </BaseMeter.Track>
    </BaseMeter.Root>
  );
};
