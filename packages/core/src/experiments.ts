/**
 * @file Experiments: features on `main` that stay off until a project or the
 *   user turns them on (ADR-066). One registry of names, the opt-in
 *   (`experimental:` in `project.yaml`, `ORK_EXPERIMENTAL`), and the one answer
 *   to whether a name is on, so no consumer reads the variable itself.
 */

import type { Env } from "@krapht/ork-integrations";
import type { Diagnostic, DiagnosticPath, Project } from "@krapht/ork-schema";

import { error } from "./graph/diagnostics.ts";

export type Experiment = {
  name: string;
  /** What it is, in a line. */
  summary: string;
  /** The spec that describes it. */
  spec: string;
};

/** The only list: an entry is added by the change that adds its experiment. */
export const EXPERIMENTS: readonly Experiment[] = [];

const EXPERIMENTAL_ENV = "ORK_EXPERIMENTAL";

export type ExperimentSource = "project" | "environment";

export type ExperimentOn = { name: string; sources: ExperimentSource[] };

export type UnknownExperiment = {
  name: string;
  source: ExperimentSource;
  /** `.ork/project.yaml:3:5`, or `ORK_EXPERIMENTAL`. */
  where: string;
  message: string;
};

export type ExperimentsState =
  | { ok: true; on: ExperimentOn[] }
  | { ok: false; unknown: UnknownExperiment[] };

export type ExperimentsOptions = {
  /** Default: this process's environment. */
  env?: Env | undefined;
  /** The project's rules; outside a project, only the environment counts. */
  project?: Pick<Project, "experimental"> | undefined;
  /** Says where a key of the project file is, for a message. */
  where?: ((path: DiagnosticPath) => string) | undefined;
  /** Default: Ork's registry; tests pass their own. */
  registry?: readonly Experiment[] | undefined;
};

/** The registry's names, for a message. */
export const knownExperiments = (
  registry: readonly Experiment[] = EXPERIMENTS,
): string => registry.map(({ name }) => name).join(", ") || "none";

const envNames = (env: Env): string[] => [
  ...new Set(
    (env[EXPERIMENTAL_ENV] ?? "")
      .split(",")
      .map(name => name.trim())
      .filter(name => name !== ""),
  ),
];

/**
 * What is on, from the project file and the environment together. Any name the
 * registry doesn't have makes it an error instead: a typo must not look like a
 * running experiment.
 */
export const experimentsOn = ({
  env = process.env,
  project,
  where,
  registry = EXPERIMENTS,
}: ExperimentsOptions = {}): ExperimentsState => {
  const inProject = project?.experimental ?? [];
  const listed = [
    ...[...new Set(inProject)].map(name => ({
      name,
      source: "project" as const,
      at: where?.(["experimental", inProject.indexOf(name)]) ?? "project.yaml",
    })),
    ...envNames(env).map(name => ({
      name,
      source: "environment" as const,
      at: EXPERIMENTAL_ENV,
    })),
  ];
  const unknown = listed
    .filter(({ name }) => !registry.some(entry => entry.name === name))
    .map(({ name, source, at }) => ({
      name,
      source,
      where: at,
      message: `${at}${source === "project" ? ":" : ""} names an unknown experiment \`${name}\`; known: ${knownExperiments(registry)}`,
    }));
  if (unknown.length > 0) return { ok: false, unknown };
  return {
    ok: true,
    on: [...new Set(listed.map(({ name }) => name))].map(name => ({
      name,
      sources: listed.filter(l => l.name === name).map(l => l.source),
    })),
  };
};

/** Whether `name` is on: what every gate asks. Off while any name is unknown. */
export const experimentOn = (
  name: string,
  options?: ExperimentsOptions,
): boolean => {
  const state = experimentsOn(options);
  return state.ok && state.on.some(entry => entry.name === name);
};

/** Unknown names as errors, for the checks every workflow goes through. */
export const experimentDiagnostics = (
  options?: ExperimentsOptions & {
    /** Where a key of the project file is, so its names are located there. */
    at?:
      | ((path: DiagnosticPath) => Pick<Diagnostic, "file" | "line" | "column">)
      | undefined;
  },
): Diagnostic[] => {
  const state = experimentsOn(options);
  if (state.ok) return [];
  const at = options?.at;
  const inProject = options?.project?.experimental ?? [];
  return state.unknown.map(({ name, source, message }) =>
    source === "project" && at !== undefined
      ? Object.assign(
          error(
            "experiment.unknown",
            `names an unknown experiment \`${name}\`; known: ${knownExperiments(options?.registry)}`,
            [],
          ),
          at(["experimental", inProject.indexOf(name)]),
        )
      : error("experiment.unknown", message, []),
  );
};

/** What a gate says of something used while its experiment is off. */
export const experimentOffMessage = (
  name: string,
  registry: readonly Experiment[] = EXPERIMENTS,
): string => {
  if (!registry.some(entry => entry.name === name)) {
    throw new Error(`\`${name}\` is not in the experiments registry`);
  }
  return `${name} is experimental; turn it on with "experimental: [${name}]" in .ork/project.yaml or ${EXPERIMENTAL_ENV}=${name}`;
};
