/**
 * @file The `omp` adapter (RFC-026): the user's own `omp -p --mode json`
 *   (oh-my-pi, 18.22.2), logged in by the user, one process per leg in the
 *   node's worktree. A later message or answer waits for the leg's end and
 *   resumes the session (`--resume <id>`); a question fork is `--fork <id>`.
 *   Every leg passes Ork's instructions, the thinking level, the built-ins the
 *   node may use (`--tools`), and, from the wiring, the session's private
 *   folder: the settings overlay (`--config`), Ork's guard as the only
 *   extension (`--trusted-extension`), the plugin that carries Ork's MCP server
 *   with its token (`--plugin-dir`), and `--session-dir` under
 *   `~/.ork/omp/sessions`. The guard refuses what the node's rules refuse and
 *   holds a paused node's next call by asking Ork's hold endpoint; a pause past
 *   the window refuses the call and asks the model to make it again, since
 *   `omp` cannot leave a call pending across processes. `--max-cost` counts the
 *   whole session, so it is what Ork's ledger says the session had spent plus
 *   `budgetUsd`. Never `-e`, `--extension`, `--hook`, `--yolo`, `--api-key`,
 *   `--profile`, `--no-session` or `--mode rpc`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { SessionSpec, ToolRules } from "@krapht/ork-core";

import type {
  CliAdapter,
  HoldHook,
  LegDecoder,
  McpWiring,
} from "../adapter.ts";
import { toolRuleSet } from "../tools/tool-rules-source.ts";
import { writeOmpSession, ompTools } from "./omp-config.ts";
import { ompDecoder, ompUsage } from "./omp-events.ts";
import { guardSource, HELD, OMP_STOPPED_FILE } from "./omp-guard.ts";
import { addSpend, sessionSpend } from "./omp-ledger.ts";

/**
 * How long a paused node's call waits before the guard refuses it with a
 * request to make it again: a pause of a working day costs a few requests.
 */
export const OMP_HOLD_WINDOW_MS = 60 * 60 * 1000;

/** The switches every leg passes: `omp`'s own extras off, print mode. */
const SWITCHES = [
  "--no-skills",
  "--no-rules",
  "--no-title",
  "--no-lsp",
  "--no-pty",
  "--no-prewalk",
  "--no-judge",
  "--no-spotlight",
  "--offline",
];

/**
 * The `omp` arguments of one leg, the brief last. The wiring's flags follow it
 * (`omp` reads flags after the brief too, checked on 18.22.2).
 */
export const ompArgs = (spec: SessionSpec): string[] => [
  "-p",
  "--mode",
  "json",
  ...SWITCHES,
  ...(spec.model === undefined ? [] : ["--model", spec.model]),
  ...(spec.resume === undefined
    ? []
    : [spec.fork === true ? "--fork" : "--resume", spec.resume]),
  "--tools",
  ompTools(spec).join(","),
  // Never `auto`: a side request would choose the level.
  "--thinking",
  spec.effort ?? "medium",
  // A resumed or forked leg does not keep them (capture legs), so every leg.
  ...(spec.systemAppend === ""
    ? []
    : ["--append-system-prompt", spec.systemAppend]),
  // A brief starting with `-` would read as a flag.
  spec.prompt.startsWith("-") ? ` ${spec.prompt}` : spec.prompt,
];

/**
 * The guard's reading of the hold endpoint's answer: `{}` lets the call run,
 * {@link HELD} refuses it with the request to make it again.
 */
export const ompHoldAnswer: HoldHook["answer"] = answer =>
  answer === "go" ? {} : { ...HELD };

export type OmpOptions = {
  /** Where the sessions' private folders go; the system's temporary folder. */
  secretRoot?: string;
  /**
   * The home whose `.ork/omp` holds the session files and the ledger; the
   * session's `HOME` by default.
   */
  home?: string;
  /** The hold window (tests shorten it); {@link OMP_HOLD_WINDOW_MS}. */
  holdWindowMs?: number;
};

/** Where Ork keeps `omp`'s session files and its own ledger, under `home`. */
export const ompFolders = (
  home: string,
): { sessions: string; spent: string } => ({
  sessions: path.join(home, ".ork", "omp", "sessions"),
  spent: path.join(home, ".ork", "omp", "spent"),
});

/**
 * What the session had spent before this start, by Ork's ledger: 0 for a new
 * session, the source's for a fork.
 */
const spentBefore = (spent: string, spec: SessionSpec): number =>
  spec.resume === undefined ? 0 : sessionSpend(spent, spec.resume);

/** Writes the stopped marker the guard checks before it acts on any call. */
const markStopped = (dir: string): void => {
  try {
    writeFileSync(path.join(dir, OMP_STOPPED_FILE), "", { mode: 0o600 });
  } catch {
    // The folder is gone: the session has ended, and no call is left to stop.
  }
};

/**
 * The home of a session: the adapter's, else the `HOME` the session runs with
 * (as `omp` reads it), else the process's.
 */
const homeOf = (
  fixed: string | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
): string => {
  const set = env?.["HOME"];
  return fixed ?? (set === undefined || set === "" ? homedir() : set);
};

/**
 * Each session's ledger folder, by its node's tool rules object: every leg's
 * spec is a copy of the session's, so it shares that object, and the leg's
 * decoder finds the folder the wiring chose without a change to `CliAdapter`.
 * shortcut: two sessions started at once from one tools object share an entry;
 * both then name the same home, so the folder is the same.
 */
const LEDGERS = new WeakMap<ToolRules, string>();

/** The session's files, flags and environment; all removed on release. */
const wiring = (
  fixedHome: string | undefined,
  holdWindowMs: number,
  root: string | undefined,
): McpWiring => ({
  kind: "config-file",
  wire: (spec, endpoint, hooks) => {
    const { sessions, spent } = ompFolders(homeOf(fixedHome, hooks.env));
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    LEDGERS.set(spec.tools, spent);
    const files = writeOmpSession(spec, endpoint, {
      guard: dir =>
        guardSource(toolRuleSet(spec), {
          dir,
          hold: endpoint.holdUrl !== undefined,
        }),
      holdWindowMs,
      ...(root === undefined ? {} : { root }),
    });
    // On a stop, at once: before the hold's answer goes out, so a held call
    // does not run whatever the answer is.
    const stop = (): void => {
      markStopped(files.dir);
    };
    if (hooks.signal.aborted) stop();
    hooks.signal.addEventListener("abort", stop, { once: true });
    const cap =
      spec.budgetUsd === undefined
        ? []
        : ["--max-cost", String(spentBefore(spent, spec) + spec.budgetUsd)];
    return Promise.resolve({
      args: [
        "--session-dir",
        sessions,
        "--config",
        files.overlay,
        "--trusted-extension",
        files.guard,
        "--plugin-dir",
        files.plugin,
        ...cap,
      ],
      // Fail closed when Ork's server is not up; Ork's tools wait as long as
      // they need (`delegate`, `ask_user`).
      env: { OMP_MCP_REQUIRE_READY: "1", OMP_MCP_TIMEOUT_MS: "0" },
      release: () => {
        if (LEDGERS.get(spec.tools) === spent) LEDGERS.delete(spec.tools);
        hooks.signal.removeEventListener("abort", stop);
        files.remove();
        return Promise.resolve();
      },
    });
  },
});

/** A leg's decoder, starting from the ledger as it is when the leg starts. */
const legDecoder =
  (fixedHome: string | undefined) =>
  (spec: SessionSpec): LegDecoder => {
    const spent =
      LEDGERS.get(spec.tools) ??
      ompFolders(homeOf(fixedHome, process.env)).spent;
    return ompDecoder(spec, {
      spentBefore: spentBefore(spent, spec),
      record: (id, usd) => {
        addSpend(spent, id, usd);
      },
    });
  };

/** `omp`, as the session runner's strategies. */
export const createOmpAdapter = (options: OmpOptions = {}): CliAdapter => {
  const windowMs = options.holdWindowMs ?? OMP_HOLD_WINDOW_MS;
  return {
    driver: "omp",
    command: { bin: "omp", args: ompArgs },
    decode: line => ompDecoder({ cwd: "" }).decode(line),
    // No result line: a leg's decoder keeps what the session's end needs.
    legDecoder: legDecoder(options.home),
    mcp: wiring(options.home, windowMs, options.secretRoot),
    permissions: { kind: "rules", denyByDefault: true },
    usage: ompUsage,
    context: {
      instructions: ["AGENTS.md"],
      skills: ".omp/skills",
      agents: ".omp/agents",
      env: () => ({}),
    },
    // No `refuse`: the reading rule is in the guard's own matcher.
    hold: { answer: ompHoldAnswer, windowMs },
  };
};

export const ompAdapter: CliAdapter = createOmpAdapter();
