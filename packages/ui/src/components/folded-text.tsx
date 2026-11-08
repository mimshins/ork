/**
 * @file Long text that folds: past about 20 lines (measured at the card's own
 *   width, so a narrow panel folds what a wide one doesn't) its first 20 show
 *   behind a "Show all (62 lines)" button that says whether the rest is
 *   showing. Where nothing can be measured it counts the source's lines. Focus
 *   entering the clipped text unfolds it, so a link can't be focused unseen
 *   (WCAG 2.4.11). It is not a scroll region: the document dialog is where long
 *   text scrolls.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Button } from "./button.tsx";
import { linesOf } from "./markdown-text.ts";

import styles from "./folded-text.module.css";

/** About how many lines show folded; `--fold-lines` in the sheet says the same. */
export const FOLD_LINES = 20;

/** The region's lines when it has a layout, or null when it has none. */
const measured = (region: HTMLElement): number | null => {
  const line = Number(getComputedStyle(region).lineHeight.replace("px", ""));
  return region.scrollHeight > 0 && line > 0
    ? Math.round(region.scrollHeight / line)
    : null;
};

export type FoldedTextProps = {
  /** The text as written, to count its lines where nothing can be measured. */
  source: string;
  children: ReactNode;
};

export const FoldedText = ({ source, children }: FoldedTextProps) => {
  const region = useRef<HTMLDivElement>(null);
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState(() => linesOf(source));

  const measure = useCallback((): void => {
    const element = region.current;
    setLines((element === null ? null : measured(element)) ?? linesOf(source));
  }, [source]);

  useEffect(() => {
    measure();
    // jsdom has no ResizeObserver: the first measure stands.
    const watch =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (region.current !== null) watch?.observe(region.current);
    return () => {
      watch?.disconnect();
    };
  }, [measure]);

  const folds = lines > FOLD_LINES;
  const toggle = (): void => {
    if (expanded) {
      // The card's top may have gone off the screen with the text under it.
      region.current
        ?.closest("section")
        ?.scrollIntoView?.({ block: "nearest" });
    }
    setExpanded(!expanded);
  };

  return (
    <>
      <div
        className={styles["region"]}
        data-folded={folds && !expanded ? "" : undefined}
        id={regionId}
        onFocus={() => {
          setExpanded(true);
        }}
        ref={region}
      >
        {children}
      </div>
      {folds ? (
        <div className={styles["more"]}>
          <Button
            aria-controls={regionId}
            aria-expanded={expanded}
            onClick={toggle}
            variant="ghost"
          >
            {expanded ? "Show less" : `Show all (${lines} lines)`}
          </Button>
        </div>
      ) : null}
    </>
  );
};
