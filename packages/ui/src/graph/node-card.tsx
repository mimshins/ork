/**
 * @file A node's card in the graph: a button that shows its type, id, cost and
 *   status, small enough for a long run to fit. Its status has a glyph and a
 *   word, so it reads without color, and its accessible name also says the
 *   model and tokens the node table and the node's strip show.
 */

import { memo } from "react";

import {
  StatusBadge,
  statusTone,
  statusWord,
} from "../components/status-badge.tsx";
import { cliDescription, Tip } from "../components/tip.tsx";
import { formatCost, type NodeFacts, nodeName } from "./facts.ts";
import { TypeIcon } from "./type-icon.tsx";
import type { PlacedNode } from "./types.ts";

import styles from "./graph.module.css";

export type NodeCardProps = {
  node: PlacedNode;
  facts: NodeFacts;
  /** Its edges in words, which the drawing only shows. */
  connections?: string | undefined;
  selected: boolean;
  /** An item of this node is the selection, in the node table. */
  holding?: boolean;
  /** Another node is being pointed at, so this one steps back. */
  dimmed: boolean;
  /** The one card of the graph that Tab reaches. */
  tabbable: boolean;
  bind: (id: string, element: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onFocused: (id: string) => void;
  onKey: (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onMenu?: ((id: string) => void) | undefined;
  onHover?: ((id: string | null) => void) | undefined;
};

export const NodeCard = memo(
  ({
    node,
    facts,
    connections,
    selected,
    holding = false,
    dimmed,
    tabbable,
    bind,
    onSelect,
    onFocused,
    onKey,
    onMenu,
    onHover,
  }: NodeCardProps) => {
    const { id, type, x, y, width, height } = node;
    const card = (
      <button
        {...cliDescription(facts.cli, connections)}
        aria-current={selected ? "true" : undefined}
        aria-label={nodeName(id, type, facts)}
        className={styles["card"]}
        data-graph-node=""
        data-dim={dimmed ? "" : undefined}
        data-holding={holding ? "" : undefined}
        data-selected={selected ? "" : undefined}
        data-tone={statusTone(facts.status)}
        onMouseEnter={() => onHover?.(id)}
        onMouseLeave={() => onHover?.(null)}
        onClick={() => {
          onSelect(id);
        }}
        onContextMenu={
          onMenu === undefined
            ? undefined
            : event => {
                event.preventDefault();
                onMenu(id);
              }
        }
        onFocus={() => {
          onFocused(id);
        }}
        onKeyDown={event => {
          onKey(id, event);
        }}
        ref={element => {
          bind(id, element);
        }}
        style={{ height, transform: `translate(${x}px, ${y}px)`, width }}
        tabIndex={tabbable ? 0 : -1}
        type="button"
      >
        <span className={styles["cardHead"]}>
          <span className={styles["cardIcon"]}>
            <TypeIcon type={type} />
          </span>
          <span className={styles["cardId"]}>{id}</span>
          {facts.costUsd === undefined ? null : (
            <span className={styles["cardCost"]}>
              {formatCost(facts.costUsd)}
            </span>
          )}
        </span>
        <StatusBadge
          status={facts.status}
          word={facts.word ?? facts.progress}
        />
      </button>
    );
    return facts.cli === undefined ? (
      card
    ) : (
      <Tip
        cli={facts.cli}
        // The card shows the progress in place of the status word.
        label={
          facts.progress === undefined
            ? undefined
            : `${facts.word ?? statusWord(facts.status)} · ${facts.progress}`
        }
      >
        {card}
      </Tip>
    );
  },
);
NodeCard.displayName = "NodeCard";
