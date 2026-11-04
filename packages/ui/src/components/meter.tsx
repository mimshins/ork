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
export const blocksOn = (
  value: number,
  max: number,
  blocks = BLOCKS,
): number => {
  if (value >= max) return blocks;
  if (value <= 0) return 0;
  return Math.min(Math.max(Math.round((value / max) * blocks), 1), blocks - 1);
};

const levelOf = (value: number, max: number): string => {
  if (value >= max) return "full";
  return value >= max * HIGH ? "high" : "normal";
};

/** The row of blocks alone, where its value is in words beside it. */
export const MeterBlocks = ({
  value,
  max,
  blocks = BLOCKS,
}: Pick<MeterProps, "value" | "max"> & { blocks?: number }) => {
  const on = blocksOn(value, max, blocks);
  return (
    <span
      aria-hidden="true"
      className={styles["track"]}
      data-level={levelOf(value, max)}
    >
      {Array.from({ length: blocks }, (_, block) => (
        <span
          className={styles["block"]}
          data-on={block < on ? "" : undefined}
          key={block}
        />
      ))}
    </span>
  );
};

export const Meter = ({ label, value, max, text }: MeterProps) => (
  <BaseMeter.Root
    aria-valuetext={text}
    className={styles["meter"]}
    data-level={levelOf(value, max)}
    max={max}
    value={Math.min(value, max)}
  >
    <BaseMeter.Label className={styles["label"]}>{label}</BaseMeter.Label>
    <span className={styles["value"]}>{text}</span>
    <MeterBlocks
      max={max}
      value={value}
    />
  </BaseMeter.Root>
);
