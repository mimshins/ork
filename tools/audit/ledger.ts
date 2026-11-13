/**
 * @file The audit's `ledger` step. It turns recon's units (most important
 *   first) into the skill's `coverage-ledger.json` and `run-metadata.json`, and
 *   applies the profile: the first N units are `planned` and handed to the
 *   hunters, the rest are written as `deferred`. The units' JSON shape is the
 *   skill's (`validate-coverage-ledger.cjs` checks it, in its own node).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { checkInputs, resolveScope, type Scope } from "./inputs.ts";
import { maxInvocations, PROFILES, type ProfileName } from "./profiles.ts";
import { outputDir, projectName } from "./store.ts";

type Env = Record<string, string | undefined>;

/**
 * What recon reports for one unit; only the four refs and the paths are
 * required.
 */
export type ReconUnit = {
  surface: string;
  boundary: string;
  subsystem: string;
  attack_class: string;
  lifecycle?: string;
  starting_paths: string[];
  ordinary_attack_class_block?: string | null;
  selected_companion_blocks?: string[];
  excluded_blocks?: { block: string; reason: string }[];
  prior_status?: string;
};

/** One unit of the skill's `coverage-ledger.json`. */
export type LedgerUnit = {
  coverage_id: string;
  canonical_refs: Record<string, string>;
  surface: string;
  boundary: string;
  subsystem: string;
  attack_class: string;
  lifecycle?: string;
  starting_paths: string[];
  ordinary_attack_class_block: string | null;
  selected_companion_blocks: string[];
  excluded_blocks: { block: string; reason: string }[];
  prior_status: string;
  attempts: never[];
  wave: number;
  status: "planned" | "deferred";
  agent_id: null;
  reviewed_paths: string[];
  local_checks: never[];
  result_fingerprints: string[];
  unresolved: string[];
};

/** What one hunter gets: its unit, and its place in the importance order. */
export type HuntItem = {
  n: number;
  coverage_id: string;
  surface: string;
  boundary: string;
  subsystem: string;
  attack_class: string;
  lifecycle?: string;
  starting_paths: string[];
  ordinary_attack_class_block: string | null;
  selected_companion_blocks: string[];
};

// The skill's coverage ID: each ref's UTF-8 bytes percent-encoded except
// A-Z a-z 0-9 - . _ ~, joined with "::" (validate-coverage-ledger.cjs).
const encodeRef = (value: string): string =>
  [...Buffer.from(value, "utf8")]
    .map(byte =>
      /[A-Za-z0-9\-._~]/u.test(String.fromCodePoint(byte))
        ? String.fromCodePoint(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");

const ref = (value: unknown, field: string): string => {
  const clean = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (clean === "") throw new Error(`a recon unit has an empty ${field}`);
  return clean;
};

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === "string")
    ? value
    : undefined;

const blocksOf = (value: unknown): { block: string; reason: string }[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return [];
        const block: unknown = Reflect.get(item, "block");
        const reason: unknown = Reflect.get(item, "reason");
        return typeof block === "string" && typeof reason === "string"
          ? [{ block, reason }]
          : [];
      })
    : [];

/** One of recon's units, checked (it is a model's output, a trust boundary). */
export const reconUnit = (value: unknown, index: number): ReconUnit => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`recon unit ${index + 1} is not an object`);
  }
  const get = (key: string): unknown => Reflect.get(value, key);
  const paths = stringList(get("starting_paths"));
  if (paths === undefined || paths.length === 0) {
    throw new Error(`recon unit ${index + 1} has no starting_paths`);
  }
  const block = get("ordinary_attack_class_block");
  const prior = get("prior_status");
  return {
    surface: ref(get("surface"), "surface"),
    boundary: ref(get("boundary"), "boundary"),
    subsystem: ref(get("subsystem"), "subsystem"),
    attack_class: ref(get("attack_class"), "attack_class"),
    ...(get("lifecycle") === undefined || get("lifecycle") === null
      ? {}
      : { lifecycle: ref(get("lifecycle"), "lifecycle") }),
    starting_paths: paths,
    ordinary_attack_class_block: typeof block === "string" ? block : null,
    selected_companion_blocks:
      stringList(get("selected_companion_blocks")) ?? [],
    excluded_blocks: blocksOf(get("excluded_blocks")),
    ...(typeof prior === "string" ? { prior_status: prior } : {}),
  };
};

/**
 * The ledger for `units` (the first `hunters` are planned, the rest deferred),
 * sorted by coverage ID as the validator requires, and the hunt list in the
 * order recon gave. A unit whose coverage ID an earlier unit already has is
 * dropped.
 */
export const buildLedger = (
  units: readonly ReconUnit[],
  profile: ProfileName,
): { ledger: LedgerUnit[]; hunt: HuntItem[]; deferred: number } => {
  const { hunters } = PROFILES[profile];
  const seen = new Set<string>();
  const ledger: LedgerUnit[] = [];
  const hunt: HuntItem[] = [];
  for (const unit of units) {
    const refs = {
      surface: ref(unit.surface, "surface"),
      boundary: ref(unit.boundary, "boundary"),
      subsystem: ref(unit.subsystem, "subsystem"),
      attack_class: ref(unit.attack_class, "attack_class"),
    };
    const lifecycle =
      unit.lifecycle === undefined
        ? undefined
        : ref(unit.lifecycle, "lifecycle");
    const canonical = lifecycle === undefined ? refs : { ...refs, lifecycle };
    const id = Object.values(canonical)
      .map(item => encodeRef(item))
      .join("::");
    if (seen.has(id)) continue;
    seen.add(id);
    const planned = hunt.length < hunters;
    const common = {
      coverage_id: id,
      surface: refs.surface,
      boundary: refs.boundary,
      subsystem: refs.subsystem,
      attack_class: refs.attack_class,
      ...(lifecycle === undefined ? {} : { lifecycle }),
      starting_paths: unit.starting_paths,
      ordinary_attack_class_block: unit.ordinary_attack_class_block ?? null,
      selected_companion_blocks: unit.selected_companion_blocks ?? [],
    };
    ledger.push({
      ...common,
      canonical_refs: canonical,
      excluded_blocks: unit.excluded_blocks ?? [],
      prior_status: unit.prior_status ?? "new",
      attempts: [],
      wave: 1,
      status: planned ? "planned" : "deferred",
      agent_id: null,
      reviewed_paths: [],
      local_checks: [],
      result_fingerprints: [],
      unresolved: planned
        ? []
        : [
            `Not hunted: the ${profile} profile hunts the first ${hunters} units by importance; rerun with a larger profile or a narrower scope.`,
          ],
    });
    if (planned) hunt.push({ n: hunt.length + 1, ...common });
  }
  // Code-unit order, as the validator compares IDs.
  const sorted = ledger.toSorted((a, b) =>
    a.coverage_id < b.coverage_id ? -1 : 1,
  );
  return { ledger: sorted, hunt, deferred: ledger.length - hunt.length };
};

const sourceRef = (cwd: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

const scopeText = (scope: Scope): string =>
  scope.kind === "diff" ? `diff:${scope.ref}` : scope.paths.join(" ");

export type LedgerResult = {
  outputDir: string;
  profile: ProfileName;
  /** Units handed to the hunters, most important first. */
  hunt: HuntItem[];
  planned: number;
  deferred: number;
};

/** Writes `run-metadata.json` and `coverage-ledger.json`; returns the hunt list. */
export const runLedger = (
  cwd: string,
  env: Env,
  recon: { units?: readonly unknown[] },
): LedgerResult => {
  const { profile, scope: asked } = checkInputs(env["PROFILE"], env["SCOPE"]);
  const dir = outputDir(cwd, env["ORK_RUN"] ?? "", env);
  const scope = resolveScope(asked, since =>
    execFileSync("git", ["diff", "--name-only", since], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(name => name !== ""),
  );
  const { ledger, hunt, deferred } = buildLedger(
    (recon.units ?? []).map((unit, index) => reconUnit(unit, index)),
    profile,
  );
  const metadata = {
    run_id: env["ORK_RUN"],
    repo: projectName(cwd, env),
    target: `${projectName(cwd, env)}, scope: ${scopeText(scope)}`,
    source_ref: sourceRef(cwd),
    profile,
    scope_paths: scope.paths,
    budget: maxInvocations(profile),
    execution_policy: "sandboxed-source-and-local-only",
    selected_companion_files: [
      ...new Set(ledger.flatMap(unit => unit.selected_companion_blocks)),
    ],
    prior_run_paths: [],
    shared_file_owners: {},
    // The skill requires a partial-coverage statement in the report.
    partial_coverage: profile === "quick" || deferred > 0,
    run_status: "in_progress",
  };
  const write = (name: string, data: unknown): void => {
    writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  };
  write("run-metadata.json", metadata);
  write("coverage-ledger.json", ledger);
  return { outputDir: dir, profile, hunt, planned: hunt.length, deferred };
};
