/**
 * @file What the Builder has open, kept in the page's state beside the run
 *   selection, so it outlives the panel: moving the panel to another group,
 *   closing and reopening it, or a window that crosses into the one-column
 *   layout mounts a new panel, which shows the same workflow, selection and
 *   undo history. The server holds the draft; this holds which one, the last
 *   answer about it, and the queue its changes wait in, so an answer on its way
 *   while no panel shows reaches the next one. Opening, selecting and each new
 *   answer tell the Context panel (context-target.ts); a panel mounting again
 *   tells it nothing.
 */

import type { BuilderEditAnswer, BuilderView } from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

export type Opened = { project: string; name: string };

/** What the Builder tells the Context panel's target it shows. */
export type BuilderChoice = {
  project: string;
  workflow: string;
  node: string | null;
  draft: boolean;
};

/** One step back: the text, and the file it was based on. */
export type Step = BuilderEditAnswer["previous"];

/** What the session tells the Context panel's target. */
type Tell = {
  chooseBuilder: (choice: BuilderChoice) => void;
  builderChanged: (project: string, workflow: string, draft: boolean) => void;
  builderClosed: () => void;
};

export type BuilderSession = ReturnType<typeof createBuilderSession>;

export const createBuilderSession = (tell: Tell) => {
  /** The project the Builder's chooser is on, once one is chosen. */
  const project = Container.create<string | null>(null);
  const opened = Container.create<Opened | null>(null);
  /** The server's last answer about what's open. */
  const view = Container.create<BuilderView | null>(null);
  const selected = Container.create<string | null>(null);
  /** This page's undo steps, up to the last save. */
  const history = Container.create<readonly Step[]>([]);
  let queue: Promise<unknown> = Promise.resolve();

  const choose = (target: Opened, node: string | null): void => {
    tell.chooseBuilder({
      project: target.project,
      workflow: target.name,
      node,
      draft: view.getValue()?.draft ?? false,
    });
  };

  return {
    project,
    opened,
    view,
    selected,
    history,
    /** Runs after everything sent before it, from any panel. */
    inTurn: <T>(work: () => Promise<T>): Promise<T> => {
      const next = queue.then(work, work);
      queue = next.catch(() => null);
      return next;
    },
    /**
     * Shows `target` with nothing carried over from what was before. Opening
     * another workflow is a choice for the Context panel; showing the same one
     * afresh, as after a discard, only asks it to plan again.
     */
    show: (target: Opened | null, shown: BuilderView | null): void => {
      const before = opened.getValue();
      void opened.setValue(target);
      void view.setValue(shown);
      void selected.setValue(null);
      void history.setValue([]);
      if (target === null) {
        tell.builderClosed();
        return;
      }
      if (target !== before) choose(target, null);
      if (shown !== null) {
        tell.builderChanged(target.project, target.name, shown.draft);
      }
    },
    /** A new answer about what's open. */
    update: (shown: BuilderView): void => {
      void view.setValue(shown);
      const target = opened.getValue();
      if (target !== null) {
        tell.builderChanged(target.project, target.name, shown.draft);
      }
    },
    /** The person selects a card, or none: the Context panel follows. */
    select: (node: string | null): void => {
      void selected.setValue(node);
      const target = opened.getValue();
      if (target !== null) choose(target, node);
    },
  };
};
