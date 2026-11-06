/**
 * @file The Context panel's stack: a node's six sections in the order `ork
 *   context explain` prints them, each with its sum and its pieces. Which
 *   pieces are open is kept by key, so asking again about the same node keeps
 *   them open.
 */

import { CodeText } from "../components/code-text.tsx";
import { Approx } from "./context-header.tsx";
import type { Section } from "./context-model.ts";
import { ContextPiece } from "./context-piece.tsx";

import styles from "./context.module.css";

export type ContextStackProps = {
  sections: readonly Section[];
  opened: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** An ask is out; what's shown is the answer from before it. */
  busy: boolean;
};

export const ContextStack = ({
  sections,
  opened,
  onToggle,
  busy,
}: ContextStackProps) => (
  <div
    aria-busy={busy}
    className={styles["stack"]}
  >
    {sections.map(section => {
      return (
        <section
          className={styles["section"]}
          key={section.id}
        >
          <div className={styles["sectionHead"]}>
            <h3 className={styles["heading"]}>{section.title}</h3>
            <span className={styles["meta"]}>
              <Approx text={section.meta} />
            </span>
          </div>
          {section.description === undefined ? null : (
            <p className={styles["sectionNote"]}>
              <CodeText text={section.description} />
            </p>
          )}
          {section.pieces.length === 0 ? (
            <p className={styles["sectionNote"]}>
              <CodeText text={section.empty} />
            </p>
          ) : (
            <ul className={styles["list"]}>
              {section.pieces.map(piece => (
                <ContextPiece
                  key={piece.key}
                  onToggle={onToggle}
                  open={opened.has(piece.key)}
                  piece={piece}
                />
              ))}
            </ul>
          )}
        </section>
      );
    })}
  </div>
);
