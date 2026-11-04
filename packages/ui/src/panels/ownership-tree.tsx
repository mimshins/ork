/**
 * @file The ownership tree: the graph's screen-reader-first twin, with the same
 *   nodes and actions as an ARIA tree. It is one tab stop. Up and down go
 *   through the rows, right opens a node or goes to its first child, left
 *   closes it or goes to its owner, Enter selects, and the menu keys ask for
 *   its controls. A row's chevron opens and closes it with a click, and its
 *   description says the node's edges. A node selected elsewhere becomes the
 *   row Tab reaches.
 */

import type { TreeNode } from "@krapht/ork-server/client";
import { type KeyboardEvent, useMemo, useState } from "react";

import { IconChevronDown, IconChevronRight } from "../components/icons.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { cliDescription } from "../components/tip.tsx";
import { formatCost, type NodeFacts, nodeName } from "../graph/facts.ts";
import { TypeIcon } from "../graph/type-icon.tsx";
import { rowsOf } from "./monitor-model.ts";

import styles from "./monitor.module.css";

const QUEUED: NodeFacts = { status: "queued" };

export const OwnershipTree = ({
  roots,
  facts,
  connections,
  selected,
  onSelect,
  onNodeMenu,
}: {
  roots: readonly TreeNode[];
  facts: ReadonlyMap<string, NodeFacts>;
  /** Each node's edges in words, from the drawing. */
  connections: ReadonlyMap<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onNodeMenu: (id: string) => void;
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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
        if (isOpen) moveTo(event, node.children[0]?.id ?? node.id);
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

  return (
    <div
      aria-label="Ownership tree"
      className={styles["tree"]}
      role="tree"
    >
      {rows.map(({ node, depth }, index) => {
        const fact = facts.get(node.id) ?? QUEUED;
        const canOpen = node.children.length > 0;
        const isOpen = canOpen && !collapsed.has(node.id);
        return (
          <div
            {...cliDescription(undefined, connections.get(node.id))}
            aria-expanded={canOpen ? isOpen : undefined}
            aria-label={nodeName(node.id, node.type, fact)}
            aria-level={depth}
            aria-selected={node.id === selected}
            className={styles["treeRow"]}
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
            role="treeitem"
            style={{ paddingInlineStart: `${String((depth - 1) * 0.75)}rem` }}
            tabIndex={node.id === shownCurrent ? 0 : -1}
          >
            {/* The row's keys open and close it; this is for the pointer. */}
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
              {canOpen && isOpen ? <IconChevronDown /> : null}
              {canOpen && !isOpen ? <IconChevronRight /> : null}
            </span>
            <span className={styles["treeIcon"]}>
              <TypeIcon type={node.type} />
            </span>
            <span className={styles["treeId"]}>{node.id}</span>
            <StatusBadge status={fact.status} />
            {fact.costUsd === undefined ? null : (
              <span className={styles["treeCost"]}>
                {formatCost(fact.costUsd)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
