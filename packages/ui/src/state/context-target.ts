/**
 * @file Which node the Context panel shows: the latest one chosen, a run's
 *   (through the shared selection the Monitor, Logs and Chats write) or the
 *   Builder's, whose draft it follows. The Builder's state lives in its own
 *   hook, so it tells this what's selected, and bumps `revision` each time its
 *   workflow changes, which is what makes the panel ask again without a timer.
 */

import { Container } from "react-containerized-state";

export type ContextTarget =
  | { kind: "run"; run: string; node: string | null }
  | {
      kind: "builder";
      project: string;
      workflow: string;
      node: string | null;
      /** Whether what's shown is an unsaved draft. */
      draft: boolean;
      /** Goes up each time the workflow changes in the Builder. */
      revision: number;
    };

export type BuilderChoice = {
  project: string;
  workflow: string;
  node: string | null;
  draft: boolean;
};

const isBuilderOf = (
  target: ContextTarget | null,
  project: string,
  workflow: string,
): target is Extract<ContextTarget, { kind: "builder" }> =>
  target?.kind === "builder" &&
  target.project === project &&
  target.workflow === workflow;

export const createContextTarget = () => {
  const target = Container.create<ContextTarget | null>(null);
  const set = (next: ContextTarget | null): void => {
    void target.setValue(next);
  };
  return {
    target,
    /** A run, and a node of it or none, was chosen. */
    chooseRun: (run: string | null, node: string | null): void => {
      set(run === null ? null : { kind: "run", run, node });
    },
    /** A node, or none, was selected in the Builder. */
    chooseBuilder: (choice: BuilderChoice): void => {
      const current = target.getValue();
      set({
        kind: "builder",
        ...choice,
        revision: isBuilderOf(current, choice.project, choice.workflow)
          ? current.revision
          : 0,
      });
    },
    /** The Builder's workflow changed: ask again, if the panel shows it. */
    builderChanged: (project: string, workflow: string, draft: boolean) => {
      const current = target.getValue();
      if (!isBuilderOf(current, project, workflow)) return;
      set({ ...current, draft, revision: current.revision + 1 });
    },
    /** The Builder closed its workflow: if the panel shows it, show nothing. */
    builderClosed: (): void => {
      if (target.getValue()?.kind === "builder") set(null);
    },
  };
};
