/**
 * @file A node's card in the graph: a button that shows its type, id, status,
 *   model, tokens and cost. Its status has an icon and a word, so it reads
 *   without color, and its accessible name says all of it.
 */

import { type ComponentType, memo } from "react";

import {
  IconAws,
  IconCall,
  IconConsole,
  IconGate,
  IconGit,
  IconGitHub,
  IconJoin,
  IconLeader,
  IconRouter,
  IconSplit,
  IconSubagent,
  IconWorker,
} from "../components/icons.tsx";
import { StatusBadge, statusTone } from "../components/status-badge.tsx";
import { cliDescription, Tip } from "../components/tip.tsx";
import { formatCost, formatTokens, type NodeFacts, nodeName } from "./facts.ts";
import type { PlacedNode } from "./types.ts";

import styles from "./graph.module.css";

const ICONS: Readonly<Record<string, ComponentType>> = {
  "claude.leader": IconLeader,
  "claude.worker": IconWorker,
  "claude.subagent": IconSubagent,
  "control.split": IconSplit,
  "control.join": IconJoin,
  "control.router": IconRouter,
  "human.gate": IconGate,
  "workflow.call": IconCall,
  "tool.gh": IconGitHub,
  "tool.aws": IconAws,
  "tool.git": IconGit,
};

export type NodeCardProps = {
  node: PlacedNode;
  facts: NodeFacts;
  selected: boolean;
  /** The one card of the graph that Tab reaches. */
  tabbable: boolean;
  bind: (id: string, element: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onFocused: (id: string) => void;
  onKey: (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onMenu?: ((id: string) => void) | undefined;
};

export const NodeCard = memo(
  ({
    node,
    facts,
    selected,
    tabbable,
    bind,
    onSelect,
    onFocused,
    onKey,
    onMenu,
  }: NodeCardProps) => {
    const { id, type, x, y, width, height } = node;
    const Icon = ICONS[type] ?? IconConsole;
    const meta = [
      facts.model,
      facts.tokens === undefined
        ? undefined
        : `${formatTokens(facts.tokens)} tok`,
      facts.costUsd === undefined ? undefined : formatCost(facts.costUsd),
    ].filter(part => part !== undefined);
    const card = (
      <button
        {...cliDescription(facts.cli)}
        aria-current={selected ? "true" : undefined}
        aria-label={nodeName(id, type, facts)}
        className={styles["card"]}
        data-graph-node=""
        data-selected={selected ? "" : undefined}
        data-tone={statusTone(facts.status)}
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
            <Icon />
          </span>
          <span className={styles["cardId"]}>{id}</span>
        </span>
        <StatusBadge status={facts.status} />
        <span className={styles["cardMeta"]}>{meta.join(" · ")}</span>
      </button>
    );
    return facts.cli === undefined ? card : <Tip cli={facts.cli}>{card}</Tip>;
  },
);
NodeCard.displayName = "NodeCard";
