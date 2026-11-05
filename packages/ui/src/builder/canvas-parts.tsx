/**
 * @file What sits around the builder's inspector: the palette of node types,
 *   the canvas, which lays itself out from the nodes and edges as the Monitor
 *   does, and the list of problems. Nothing here is dragged.
 */

import type { Diagnostic } from "@krapht/ork-server/client";

import { CodeText } from "../components/code-text.tsx";
import { typeWord } from "../graph/facts.ts";
import { TypeIcon } from "../graph/type-icon.tsx";
import {
  errorCount,
  newNodeId,
  nodeOfProblem,
  problemWords,
} from "./builder-model.ts";
import { nodeTypesOf } from "./schema-model.ts";
import type { Builder } from "./use-builder.ts";

import styles from "./builder.module.css";

export const Palette = ({ builder }: { builder: Builder }) => {
  const types = builder.schema === null ? [] : nodeTypesOf(builder.schema);
  const taken = builder.view?.graph.nodes.map(({ id }) => id) ?? [];
  const add = async (type: string): Promise<void> => {
    const id = newNodeId(type, taken);
    if (await builder.edit({ op: "addNode", id, node: { type } })) {
      builder.select(id);
    }
  };
  return (
    <nav
      aria-label="Add a node"
      className={styles["palette"]}
    >
      <h2 className={styles["heading"]}>Add a node</h2>
      <ul className={styles["types"]}>
        {types.map(type => (
          <li key={type}>
            <button
              className={styles["type"]}
              onClick={() => {
                void add(type);
              }}
              type="button"
            >
              <TypeIcon type={type} />
              {typeWord(type)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export const Problems = ({
  problems,
  walk,
  onChoose,
}: {
  problems: readonly Diagnostic[];
  /** What walking every way through came to, when it could be walked. */
  walk: string | null;
  onChoose: (node: string) => void;
}) => {
  if (problems.length === 0) {
    return (
      <output className={styles["clean"]}>
        No problems found.{walk === null ? "" : ` ${walk}`}
      </output>
    );
  }
  return (
    <section
      aria-label="Problems"
      className={styles["problems"]}
    >
      <div className={styles["problemsHead"]}>
        <h2 className={styles["heading"]}>
          {errorCount(problems) > 0 ? "Fix these before saving" : "Warnings"}
        </h2>
        {walk === null ? null : <p className={styles["walk"]}>{walk}</p>}
      </div>
      <ul className={styles["problemList"]}>
        {problems.map(problem => {
          const node = nodeOfProblem(problem);
          const key = `${problem.code} ${problem.path.join(".")} ${problem.message}`;
          return (
            <li key={key}>
              {node === undefined ? (
                <span>
                  <CodeText text={problemWords(problem)} />
                </span>
              ) : (
                <button
                  className={styles["problemLink"]}
                  onClick={() => {
                    onChoose(node);
                  }}
                  type="button"
                >
                  {/* A message that starts by naming it needs no label. */}
                  {problemWords(problem).startsWith(`\`${node}\``) ? null : (
                    <>
                      <code>{node}</code>:{" "}
                    </>
                  )}
                  <CodeText text={problemWords(problem)} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
