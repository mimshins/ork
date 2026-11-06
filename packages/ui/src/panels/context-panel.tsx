/**
 * @file The Context panel: what the latest chosen node's session loads, layer
 *   by layer, as `ork context explain` prints it, with each piece's words a
 *   click away. A run's node is planned from its files as they are now, and
 *   names any that changed after the run started; a Builder's node follows the
 *   draft. It edits nothing, and takes the focus only when it already has it.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useValue } from "react-containerized-state";

import type { ContextTarget } from "../state/context-target.ts";
import { useAppState } from "../state/context.tsx";
import { ContextHeader } from "./context-header.tsx";
import { cliTwin, fromRoot, sectionsOf } from "./context-model.ts";
import {
  ContextFoot,
  HeaderNotes,
  NoNode,
  NotPlanned,
} from "./context-notes.tsx";
import { ContextStack } from "./context-stack.tsx";
import {
  type NodeTarget,
  nodeKeyOf,
  useNodeContext,
} from "./use-node-context.ts";

import styles from "./context.module.css";

/** Where it's planned from, the CLI command, and the sentence on it. */
const useWhere = (target: NodeTarget) => {
  const runs = useValue(useAppState().runs);
  if (target.kind === "builder") {
    return {
      from: `Builder · ${target.workflow}${target.draft ? " · draft" : ""}`,
      cli: cliTwin(target.workflow, target.node),
      planned: target.draft
        ? "Planned from the unsaved draft. It updates after each edit."
        : "Planned from the saved file.",
    };
  }
  const run = runs?.find(({ id }) => id === target.run);
  return {
    // As the Decisions panel names a run: its workflow, then its whole id.
    from: run === undefined ? target.run : `${run.workflow} · ${target.run}`,
    cli: cliTwin(
      run === undefined ? "<workflow>" : fromRoot(run.file, run.project),
      target.node,
    ),
    planned: "Planned from the project's files as they are now.",
  };
};

type ViewProps = {
  target: NodeTarget;
  /** Whether the focus was in the panel last, which outlives a node. */
  hadFocus: RefObject<boolean>;
};

const NodeContextView = ({ target, hadFocus }: ViewProps) => {
  const { answer, error, loading, reload } = useNodeContext(target);
  const where = useWhere(target);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const toggle = useCallback((key: string) => {
    setOpened(before => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const planned = answer?.planned === true ? answer.explanation : null;
  const sections = useMemo(
    () => (planned === null ? [] : sectionsOf(planned)),
    [planned],
  );
  const phase =
    answer === null ? (error === null ? "loading" : "failed") : "shown";
  const shownPhase = useRef<string | null>(null);
  // A new node, or a new state of it, takes the focus to its heading, but
  // only from inside the panel: it never takes it from the Monitor or Builder.
  // A new answer for the same node does so only if the focused row went.
  useEffect(() => {
    const active = document.activeElement;
    const inside = active !== null && root.current?.contains(active) === true;
    const dropped =
      (active === null || active === document.body) && hadFocus.current;
    const moved = shownPhase.current !== phase;
    shownPhase.current = phase;
    if (dropped || (moved && inside)) title.current?.focus();
    // The focus flag is a ref the panel owns: reading it never re-runs this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [phase, answer]);
  return (
    <div
      className={styles["panel"]}
      ref={root}
    >
      <ContextHeader
        appendedTokens={planned?.appendedTokens}
        cli={where.cli}
        from={where.from}
        node={target.node}
        onReload={reload}
        planned={answer?.planned === false ? null : where.planned}
        reload={error === null ? "Reload" : "Try again"}
        titleRef={title}
        type={planned?.type}
        updating={loading && answer !== null}
      >
        <HeaderNotes
          answer={answer}
          error={error}
        />
      </ContextHeader>
      {answer?.planned === false ? <NotPlanned why={answer.why} /> : null}
      {planned === null ? null : (
        <ContextStack
          busy={loading}
          onToggle={toggle}
          opened={opened}
          sections={sections}
        />
      )}
      {answer === null && error === null ? (
        <p
          aria-busy="true"
          className={styles["card"]}
        >
          <span className={styles["description"]}>
            {`Planning ${target.node}…`}
          </span>
        </p>
      ) : null}
      {phase === "loading" ? null : (
        <ContextFoot
          cli={where.cli}
          draft={target.kind === "builder" && target.draft}
          sized={planned !== null}
        />
      )}
    </div>
  );
};

type ShownProps = {
  target: ContextTarget | null;
  hadFocus: RefObject<boolean>;
};

/**
 * No node to show. When the one shown goes while the focus was on it, the focus
 * comes here rather than to the page.
 */
const Nothing = ({ target, hadFocus }: ShownProps) => {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const dropped = active === null || active === document.body;
    if (dropped && hadFocus.current) root.current?.focus();
  }, [hadFocus]);
  return (
    <div
      ref={root}
      tabIndex={-1}
    >
      <NoNode target={target} />
    </div>
  );
};

const Shown = ({ target, hadFocus }: ShownProps) => {
  if (target === null || target.node === null) {
    return (
      <Nothing
        hadFocus={hadFocus}
        target={target}
      />
    );
  }
  const chosen: NodeTarget = { ...target, node: target.node };
  return (
    <NodeContextView
      hadFocus={hadFocus}
      key={nodeKeyOf(chosen)}
      target={chosen}
    />
  );
};

export const ContextPanel = () => {
  const target = useValue(useAppState().contextTarget);
  const hadFocus = useRef(false);
  return (
    <div
      className={styles["host"]}
      onBlur={event => {
        const next = event.relatedTarget;
        // Focus left for elsewhere, or for nowhere (a click on the page) while
        // what had it is still there; a row taken away keeps the flag.
        const left =
          next instanceof Node
            ? !event.currentTarget.contains(next)
            : event.target.isConnected;
        if (left) hadFocus.current = false;
      }}
      onFocus={() => {
        hadFocus.current = true;
      }}
    >
      <Shown
        hadFocus={hadFocus}
        target={target}
      />
    </div>
  );
};
