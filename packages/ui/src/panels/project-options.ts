/** @file The project filter's options, shared by the panels that have one. */

import type { Option } from "../components/select.tsx";
import { ALL_PROJECTS } from "../state/preferences.ts";

export { ALL_PROJECTS };

export const baseName = (root: string): string =>
  root.split("/").at(-1) ?? root;

/** The folder and its parent, to tell apart two projects of the same name. */
const longName = (root: string): string => root.split("/").slice(-2).join("/");

/** A run's project may be unregistered by now, so runs add to the list. */
export const projectOptions = (
  projects: readonly { id: string; root: string }[],
  runs: readonly { project: string }[],
): Option[] => {
  const known = new Map(projects.map(({ root, id }) => [root, id]));
  for (const { project } of runs) {
    if (!known.has(project)) known.set(project, baseName(project));
  }
  const labels = [...known.values()];
  const repeated = (label: string): boolean =>
    labels.indexOf(label) !== labels.lastIndexOf(label);
  return [
    { value: ALL_PROJECTS, label: "All projects" },
    ...[...known]
      .map(([value, label]) => ({
        value,
        label: repeated(label) ? longName(value) : label,
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label)),
  ];
};
