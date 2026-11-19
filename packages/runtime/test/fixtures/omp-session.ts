/**
 * @file The `omp` driver's test sessions: an adapter whose folders are all
 *   temporary, and a session of it on the fake `omp` (fake-omp.mjs) playing a
 *   scenario or a script, with what the fake recorded of each leg and call.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  HumanChannel,
  SessionPorts,
  SessionSpec,
} from "@krapht/ork-core";
import { z } from "zod";

import type { CliAdapter, OrkEndpoint } from "../../src/adapter.ts";
import { createOmpAdapter, createSessionRuntime } from "../../src/index.ts";

export const temp = (prefix: string): string =>
  mkdtempSync(path.join(tmpdir(), prefix));

/** The value after `flag` in `args`, or `undefined`. */
export const valueOf = (
  args: readonly string[],
  flag: string,
): string | undefined => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};

/** The value after `flag` in `args`, which must be there. */
export const flagOf = (args: readonly string[], flag: string): string => {
  const found = valueOf(args, flag);
  if (found === undefined) throw new Error(`no ${flag} in ${args.join(" ")}`);
  return found;
};

export const ompSpec: SessionSpec = {
  nodeId: "om",
  cwd: "/work",
  prompt: "Do the task",
  systemAppend: "# Ork",
  settingSources: ["project", "local"],
  tools: { allow: [], deny: [] },
  permissionMode: "default",
  reportSchema: { type: "object" },
};

/** An adapter whose folders are all temporary, and its home and root. */
export const adapterIn = (holdWindowMs?: number, home = temp("ork-omp-home-")) => {
  const root = temp("ork-omp-root-");
  const adapter = createOmpAdapter({
    home,
    secretRoot: root,
    ...(holdWindowMs === undefined ? {} : { holdWindowMs }),
  });
  return { adapter, home, root };
};

const RecordSchema = z.object({
  kind: z.string(),
  pid: z.number(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  cwd: z.string().optional(),
  toolCallId: z.string().optional(),
  tool: z.string().optional(),
  input: z.unknown().optional(),
  reason: z.string().optional(),
});

export type Recorded = z.infer<typeof RecordSchema>;

const FAKE = fileURLToPath(new URL("fake-omp.mjs", import.meta.url));

const human: HumanChannel = {
  ask: ({ recommended }) => Promise.resolve(recommended ?? "none"),
  permit: () => Promise.resolve({ allow: false, message: "not in this run" }),
};

/** Every record file a session of {@link played} wrote, for a check over all. */
export const RECORDS: string[] = [];

export type Play = {
  /** `FAKE_SCENARIO`. */
  scenario?: string;
  /** `FAKE_OMP_SCRIPT`: the requests the fake makes. */
  script?: unknown[];
  /** Over the node's spec. */
  over?: Partial<SessionSpec>;
  /** More of the fake's environment. */
  env?: Record<string, string>;
  /** The run's ports beside the human channel. */
  ports?: Omit<SessionPorts, "human">;
  holdWindowMs?: number;
  /** The home of an earlier session, to resume one of its sessions. */
  home?: string;
  /** Changes the adapter, e.g. to tamper with its wiring. */
  adapt?: (adapter: CliAdapter) => CliAdapter;
};

/**
 * Changes what the adapter's wiring wrote before the leg starts: `change` gets
 * the private folder and the endpoint the session runner gave.
 */
export const tampered =
  (change: (dir: string, endpoint: OrkEndpoint) => void) =>
  (adapter: CliAdapter): CliAdapter => ({
    ...adapter,
    mcp: {
      ...adapter.mcp,
      wire: async (spec, endpoint, hooks) => {
        const wired = await adapter.mcp.wire(spec, endpoint, hooks);
        change(path.dirname(flagOf(wired.args, "--config")), endpoint);
        return wired;
      },
    },
  });

/** A session on the fake `omp`, with what the fake recorded. */
export const played = (play: Play = {}) => {
  const { adapter, home, root } = adapterIn(play.holdWindowMs, play.home);
  const cwd = temp("ork-omp-cwd-");
  const record = path.join(temp("ork-omp-record-"), "legs.jsonl");
  RECORDS.push(record);
  const session = createSessionRuntime(play.adapt?.(adapter) ?? adapter, {
    bin: FAKE,
    env: {
      ...process.env,
      HOME: home,
      FAKE_OMP_RECORD: record,
      ...(play.scenario === undefined ? {} : { FAKE_SCENARIO: play.scenario }),
      ...(play.script === undefined
        ? {}
        : { FAKE_OMP_SCRIPT: JSON.stringify(play.script) }),
      ...play.env,
    },
  }).start({ ...ompSpec, cwd, ...play.over }, { human, ...play.ports });
  const all = () => recordsIn(record);
  const legs = () => all().filter(each => each.kind === "leg");
  const calls = (kind: string) => all().filter(each => each.kind === kind);
  return { session, cwd, home, root, legs, calls };
};

const FENCE = ["--trusted-extension", "--plugin-dir", "--config"];

/** The legs of every session {@link played} started that lacked a fence flag. */
export const unfenced = (): Recorded[] =>
  RECORDS.flatMap(recordsIn).filter(
    each =>
      each.kind === "leg" &&
      FENCE.some(flag => valueOf(each.args, flag) === undefined),
  );

/** What the fake recorded in `file`; nothing when no leg started. */
export const recordsIn = (file: string): Recorded[] => {
  const text = (() => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  })();
  return text
    .split("\n")
    .filter(each => each !== "")
    .map(each => RecordSchema.parse(JSON.parse(each)));
};
