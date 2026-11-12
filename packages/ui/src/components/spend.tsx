/**
 * @file A spend in dollars and in counted tokens (RFC-015). A dollar sum that
 *   misses sessions on a driver with no price reads as a floor, `≥ $1.20`, with
 *   a tip and an accessible name that say so; the tokens count every session
 *   and sit beside it in the muted color, never in its place unless the node
 *   has no dollars at all.
 */

import { formatTokens } from "../graph/facts.ts";
import { Tip } from "./tip.tsx";
import { Unseen } from "./unseen.tsx";

import styles from "./spend.module.css";

/** The tip opens on focus, so where a sum stands alone a keyboard reaches it. */
const FOCUSABLE = { tabIndex: 0 };

export const PARTIAL_TIP =
  "At least this much. Some sessions ran on a driver that reports no price, so their dollars are not counted. Tokens count every session.";

export const UNPRICED_TIP =
  "No price for this driver. Counted tokens are shown.";

/**
 * Dollars already formatted. Partial ones get the floor sign and the tip; the
 * trigger takes the keyboard only where the sum stands alone (`focusable`),
 * since a row that is itself one tab stop already carries the words.
 */
export const Dollars = ({
  text,
  partial,
  focusable = false,
}: {
  text: string;
  partial: boolean;
  focusable?: boolean;
}) =>
  partial ? (
    <Tip label={PARTIAL_TIP}>
      <span {...(focusable ? FOCUSABLE : {})}>
        <span aria-hidden="true">{`≥ ${text}`}</span>
        <Unseen>{`at least ${text}, partial`}</Unseen>
      </span>
    </Tip>
  ) : (
    text
  );

/** Counted tokens in words, or `tok` where the column is tight. */
export const TokenCount = ({
  count,
  unit = "tokens",
}: {
  count: number;
  unit?: "tokens" | "tok";
}) => (
  <span className={styles["tokens"]}>{`${formatTokens(count)} ${unit}`}</span>
);

/** What a node's unpriced cost slot says, with the tip that explains it. */
export const UnpricedTokens = ({ count }: { count: number }) => (
  <Tip label={UNPRICED_TIP}>
    <span>
      <TokenCount
        count={count}
        unit="tok"
      />
    </span>
  </Tip>
);

const COUNTED_TIP =
  "Input, output and cache-write tokens, as budgetTokens counts them. Cache reads are not counted.";

/** The term "Tokens counted", with the tip that says what counts. */
export const CountedTerm = () => (
  <Tip label={COUNTED_TIP}>
    <span {...FOCUSABLE}>Tokens counted</span>
  </Tip>
);
