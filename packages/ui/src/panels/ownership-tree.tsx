/**
 * @file The node table: the graph's screen-reader-first twin, with the same
 *   nodes and actions, as an ARIA tree whose rows line up in columns: what each
 *   node is, how it stands, what it's doing, and its time and cost. It is one
 *   tab stop. Up and down go through the rows, right opens a node or goes to
 *   its first child, left closes it or goes to its owner, Enter selects, and
 *   the menu keys ask for its controls. A row's chevron opens and closes it
 *   with a click, and its description says the node's edges. A node selected
 *   elsewhere becomes the row Tab reaches.
 */

import type { TreeNode, WorkflowGraph } from "@krapht/ork-server/client";
import { type KeyboardEvent, useId, useMemo, useState } from "react";

import { UnpricedTokens } from "../components/spend.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { cliDescription, Tip } from "../components/tip.tsx";
import { formatCost, type NodeFacts, nodeName } from "../graph/facts.ts";
import { childrenOf, itemIndex, rowsOf } from "./monitor-model.ts";
import { Chevron, NodeTableHead, useFolded } from "./node-table-head.tsx";
import { nowLine, timeLine } from "./node-table.ts";

import styles from "./monitor.module.css";

const QUEUED: NodeFacts = { status: "queued" };

export const OwnershipTree = ({
  roots,
  facts,
  connections,
  selected,
  edges,
  hovered,
  now,
  runFinishedAt,
  onHover,
  onSelect,
  onNodeMenu,
}: {
  roots: readonly TreeNode[];
  facts: ReadonlyMap<string, NodeFacts>;
  /** Each node's edges in words, from the drawing. */
  connections: ReadonlyMap<string, string>;
  selected: string | null;
  edges: WorkflowGraph["edges"];
  /** The node being pointed at, here or in the graph. */
  hovered: string | null;
  now: number;
  runFinishedAt: string | undefined;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onNodeMenu: (id: string) => void;
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [folded, toggleFolded] = useFolded();
  const treeId = useId();
  const [current, setCurrent] = useState<string | null>(selected);
  const [lastSelected, setLastSelected] = useState(selected);
  if (selected !== lastSelected) {
    setLastSelected(selected);
    if (selected !== null) setCurrent(selected);
  }
  const rows = useMemo(() => rowsOf(roots, collapsed), [roots, collapsed]);
  const shownCurrent = rows.some(({ node }) => node.id === current)
    ? current
    : (rows[0]?.node.id ?? null);

  const setOpen = (id: string, open: boolean): void => {
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const moveTo = (event: KeyboardEvent<HTMLElement>, id: string): void => {
    setCurrent(id);
    const items =
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
        "[data-tree-row]",
      );
    [...(items ?? [])].find(item => item.dataset["treeRow"] === id)?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLElement>, index: number): void => {
    const row = rows[index];
    if (row === undefined) return;
    const { node, parent } = row;
    const hasChildren = node.children.length > 0;
    const isOpen = hasChildren && !collapsed.has(node.id);
    const moves: Readonly<Record<string, () => void>> = {
      ArrowDown: () => {
        const next = rows[index + 1];
        if (next !== undefined) moveTo(event, next.node.id);
      },
      ArrowUp: () => {
        const before = rows[index - 1];
        if (before !== undefined) moveTo(event, before.node.id);
      },
      ArrowRight: () => {
        if (!hasChildren) return;
        if (isOpen) moveTo(event, childrenOf(node)[0]?.id ?? node.id);
        else setOpen(node.id, true);
      },
      ArrowLeft: () => {
        if (isOpen) setOpen(node.id, false);
        else if (parent !== undefined) moveTo(event, parent);
      },
      Home: () => {
        moveTo(event, rows[0]?.node.id ?? node.id);
      },
      End: () => {
        moveTo(event, rows.at(-1)?.node.id ?? node.id);
      },
      Enter: () => {
        onSelect(node.id);
      },
      " ": () => {
        onSelect(node.id);
      },
      ContextMenu: () => {
        onNodeMenu(node.id);
      },
    };
    const key =
      event.key === "F10" && event.shiftKey ? "ContextMenu" : event.key;
    const move = moves[key];
    if (move !== undefined) {
      event.preventDefault();
      move();
    }
  };

  const statusOf = (id: string) => facts.get(id)?.status;
  const nested = rows.some(({ node }) => node.children.length > 0);

  return (
    <div
      className={styles["table"]}
      data-folded={folded ? "" : undefined}
    >
      <NodeTableHead
        count={rows.length}
        folded={folded}
        onToggle={toggleFolded}
        treeId={treeId}
      />
      <div
        aria-label="Ownership tree"
        className={styles["tree"]}
        hidden={folded}
        id={treeId}
        role="tree"
      >
        {rows.map(({ node, depth }, index) => {
          const fact = facts.get(node.id) ?? QUEUED;
          const canOpen = node.children.length > 0;
          const isOpen = canOpen && !collapsed.has(node.id);
          const doing = nowLine(
            node,
            fact.status,
            edges,
            statusOf,
            now,
            fact.progress,
          );
          return (
            <div
              {...cliDescription(
                itemIndex(node) === undefined ? undefined : fact.cli,
                connections.get(node.id),
              )}
              aria-expanded={canOpen ? isOpen : undefined}
              aria-label={[
                nodeName(node.id, node.type, {
                  ...fact,
                  progress: undefined,
                  description: node.description,
                }),
                ...(doing === "" ? [] : [doing]),
              ].join(", ")}
              aria-level={depth}
              aria-selected={node.id === selected}
              className={styles["treeRow"]}
              data-dim={
                hovered !== null && hovered !== node.id ? "" : undefined
              }
              data-selected={node.id === selected ? "" : undefined}
              data-tree-row={node.id}
              key={node.id}
              onClick={() => {
                setCurrent(node.id);
                onSelect(node.id);
              }}
              onContextMenu={event => {
                event.preventDefault();
                onNodeMenu(node.id);
              }}
              onKeyDown={event => {
                onKey(event, index);
              }}
              onMouseEnter={() => {
                onHover(node.id);
              }}
              onMouseLeave={() => {
                onHover(null);
              }}
              role="treeitem"
              tabIndex={node.id === shownCurrent ? 0 : -1}
            >
              <span
                className={styles["treeNode"]}
                style={{
                  paddingInlineStart: `${String((depth - 1) * 0.75)}rem`,
                }}
              >
                {/* The row's keys open and close it; this is for the pointer. */}
                {nested ? (
                  <span
                    aria-hidden="true"
                    className={styles["treeToggle"]}
                    onClick={
                      canOpen
                        ? event => {
                            event.stopPropagation();
                            setOpen(node.id, !isOpen);
                          }
                        : undefined
                    }
                  >
                    {canOpen ? <Chevron open={isOpen} /> : null}
                  </span>
                ) : null}
                <span className={styles["treeId"]}>{node.id}</span>
                {node.description === undefined ||
                node.description === "" ? null : (
                  // Hover only: the row's own name already says the label.
                  <Tip label={node.description}>
                    <span className={styles["treeLabel"]}>
                      {node.description}
                    </span>
                  </Tip>
                )}
              </span>
              <span className={styles["treeType"]}>{node.type}</span>
              <span className={styles["treeStatus"]}>
                <StatusBadge status={fact.status} />
              </span>
              <span className={styles["treeNow"]}>{doing}</span>
              <span className={styles["treeTime"]}>
                {timeLine(node, runFinishedAt, now)}
              </span>
              <span className={styles["treeCost"]}>
                {fact.unpriced === true && fact.tokens !== undefined ? (
                  <UnpricedTokens count={fact.tokens} />
                ) : fact.costUsd === undefined ? (
                  "–"
                ) : (
                  formatCost(fact.costUsd)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
