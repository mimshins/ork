/**
 * @file Which node the Context panel shows: the latest one chosen, a run's
 *   (through the shared selection the Monitor, Logs and Chats write) or the
 *   Builder's, whose draft it follows. The Builder's session
 *   (builder-session.ts) is made here, with this to tell: what's selected, and
 *   a bump of `revision` each time its workflow changes, which is what makes
 *   the panel ask again without a timer.
 */

import { Container } from "react-containerized-state";

import { type BuilderChoice, createBuilderSession } from "./builder-session.ts";

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
  /** A node, or none, was selected in the Builder. */
  const chooseBuilder = (choice: BuilderChoice): void => {
    const current = target.getValue();
    set({
      kind: "builder",
      ...choice,
      revision: isBuilderOf(current, choice.project, choice.workflow)
        ? current.revision
        : 0,
    });
  };
  /** The Builder's workflow changed: ask again, if the panel shows it. */
  const builderChanged = (
    project: string,
    workflow: string,
    draft: boolean,
  ): void => {
    const current = target.getValue();
    if (!isBuilderOf(current, project, workflow)) return;
    set({ ...current, draft, revision: current.revision + 1 });
  };
  /** The Builder closed its workflow: if the panel shows it, show nothing. */
  const builderClosed = (): void => {
    if (target.getValue()?.kind === "builder") set(null);
  };
  return {
    target,
    chooseBuilder,
    builderChanged,
    builderClosed,
    /** What the Builder has open, which tells this what it shows. */
    builder: createBuilderSession({
      chooseBuilder,
      builderChanged,
      builderClosed,
    }),
    /** A run, and a node of it or none, was chosen. */
    chooseRun: (run: string | null, node: string | null): void => {
      set(run === null ? null : { kind: "run", run, node });
    },
  };
};
