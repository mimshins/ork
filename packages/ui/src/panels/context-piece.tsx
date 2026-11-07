/**
 * @file One piece of a node's context: a row that opens its words, showing
 *   whether it's live, its layer, where it comes from and its size, and, when
 *   it's off, why. The words show exactly as the session reads them, in a well
 *   with where they come from and a copy button. A piece with no words (a
 *   skipped practice) is a row that doesn't open.
 */

import { useId } from "react";

import { CodeText } from "../components/code-text.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconMinus,
} from "../components/icons.tsx";
import { Approx } from "./context-header.tsx";
import { approx, linesOf, type Piece, sentence } from "./context-model.ts";

import styles from "./context.module.css";

/**
 * Words only a screen reader hears, after a cell's own: what a cell is
 * ("layer", "tokens"), then a comma when another cell follows, so the row is
 * heard as "review, off, project layer, …, about 9 tokens".
 */
const Hidden = ({ words, more }: { words: string; more: boolean }) => {
  const text = `${words}${more ? ", " : ""}`;
  return text === "" ? null : (
    <span className={styles["visuallyHidden"]}>{text}</span>
  );
};

/**
 * A row's cells on the panel's grid: the mark always has its column, so every
 * name starts at one edge down the stack; state, layer and source go on a
 * second line in a narrow panel, and on the first in a wide one. The row's name
 * is what it shows, read in order.
 */
const Cells = ({ piece }: { piece: Piece }) => {
  const shown = [piece.state, piece.layer, piece.source, piece.tokens];
  const more = (after: number): boolean =>
    shown.slice(after).some(cell => cell !== undefined);
  const details =
    piece.state !== undefined ||
    piece.layer !== undefined ||
    piece.source !== undefined;
  return (
    <>
      <span
        className={styles["mark"]}
        data-state={piece.state}
      >
        {piece.state === undefined ? null : piece.state === "live" ? (
          <IconCheck />
        ) : (
          <IconMinus />
        )}
      </span>
      <span className={styles["name"]}>
        {piece.name}
        <Hidden
          more={more(0)}
          words=""
        />
      </span>
      {details ? (
        <span className={styles["details"]}>
          {piece.state === undefined ? null : (
            <span className={styles["state"]}>
              {piece.state}
              <Hidden
                more={more(1)}
                words=""
              />
            </span>
          )}
          {piece.layer === undefined ? null : (
            <span className={styles["layer"]}>
              {piece.layer}
              <Hidden
                more={more(2)}
                words=" layer"
              />
            </span>
          )}
          {piece.source === undefined ? null : (
            <span className={styles["source"]}>
              {piece.source}
              <Hidden
                more={more(3)}
                words=""
              />
            </span>
          )}
        </span>
      ) : null}
      {piece.tokens === undefined ? null : (
        <span className={styles["tokens"]}>
          <Approx text={approx(piece.tokens)} />
          <Hidden
            more={false}
            words=" tokens"
          />
        </span>
      )}
    </>
  );
};

const Words = ({ piece, id }: { piece: Piece; id: string }) => {
  const text = piece.text ?? "";
  const lines = linesOf(text);
  return (
    <div
      className={styles["well"]}
      id={id}
    >
      <div className={styles["wellBar"]}>
        <span className={styles["wellPlace"]}>{piece.place}</span>
        <span>
          <Approx
            text={`${lines.toLocaleString("en")} ${lines === 1 ? "line" : "lines"}${piece.tokens === undefined ? "" : ` · ${approx(piece.tokens)} tokens`}`}
          />
        </span>
        <span className={styles["wellCopy"]}>
          <CopyButton
            label={`Copy the text of ${piece.name}`}
            resultClass={styles["copied"]}
            text={text}
          />
        </span>
      </div>
      {text === "" ? (
        <p className={styles["emptyText"]}>
          {piece.key === "appended"
            ? "Nothing is appended."
            : "This file is empty."}
        </p>
      ) : (
        <pre className={styles["text"]}>{text}</pre>
      )}
    </div>
  );
};

export type ContextPieceProps = {
  piece: Piece;
  open: boolean;
  onToggle: (key: string) => void;
};

export const ContextPiece = ({ piece, open, onToggle }: ContextPieceProps) => {
  const id = useId();
  const whyId = `${id}-why`;
  const wellId = `${id}-text`;
  const state = piece.state ?? "live";
  const why =
    piece.why === undefined ? null : (
      <p
        className={styles["why"]}
        id={whyId}
      >
        <CodeText text={sentence(piece.why)} />
      </p>
    );
  if (piece.text === undefined) {
    return (
      <li className={styles["item"]}>
        <div
          className={styles["row"]}
          data-state={state}
        >
          <span className={styles["toggle"]} />
          <Cells piece={piece} />
        </div>
        {why}
      </li>
    );
  }
  return (
    <li className={styles["item"]}>
      <button
        aria-controls={open ? wellId : undefined}
        aria-describedby={piece.why === undefined ? undefined : whyId}
        aria-expanded={open}
        className={styles["row"]}
        data-piece={piece.key}
        data-state={state}
        onClick={() => {
          onToggle(piece.key);
        }}
        type="button"
      >
        <span className={styles["toggle"]}>
          {open ? <IconChevronDown /> : <IconChevronRight />}
        </span>
        <Cells piece={piece} />
      </button>
      {why}
      {open ? (
        <Words
          id={wellId}
          piece={piece}
        />
      ) : null}
    </li>
  );
};
