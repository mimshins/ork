/**
 * @file The `omp` adapter (RFC-026, RFC-027): the user's own `omp --mode rpc`
 *   (oh-my-pi, 18.22.2), logged in by the user, one long-lived process per leg
 *   in the node's worktree, driven through the `omp-rpc.ts` codec. A message is
 *   a `steer` frame to the running process, an interrupt an `abort`, and a tool
 *   `omp` asks about is approved through Ork's human channel; a question fork
 *   is `--fork <id>`. Every leg passes Ork's instructions, the thinking level,
 *   the built-ins the node may use (`--tools`), and, from the wiring, the
 *   session's private folder: the settings overlay (`--config`), Ork's guard as
 *   the only extension (`--trusted-extension`), and `--session-dir` under
 *   `~/.ork/omp/sessions`. Ork's tools are host tools the codec offers over the
 *   leg's pipe (`set_host_tools`, `ork_<tool>`), run by the runner; no plugin,
 *   no MCP server, and the token only in the guard's `hold.json`. The guard
 *   refuses what the node's rules refuse and holds a paused node's next call by
 *   asking Ork's hold endpoint; a pause past the window refuses the call, the
 *   runner ends the leg with an `abort`, and `ork continue` resumes it
 *   (`--resume <id>`) with a message to make the held call again. `--max-cost`
 *   counts the whole session, so it is what Ork's ledger says the session had
 *   spent plus `budgetUsd`. Never `-p`, `--no-ui`, `-e`, `--extension`,
 *   `--hook`, `--yolo`, `--api-key`, `--profile` or `--no-session`.
 */

// oxlint-disable import/max-dependencies -- the adapter composes one module per strategy
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { SessionSpec, ToolRules } from "@krapht/ork-core";

import type { Codec, CliAdapter, HoldHook, McpWiring } from "../adapter.ts";
import { toolRuleSet } from "../tools/tool-rules-source.ts";
import { HOLD_WINDOW_MS } from "./claude-code.ts";
import { writeOmpSession, ompTools } from "./omp-config.ts";
import { ompDecoder, ompUsage } from "./omp-events.ts";
import { guardSource, HELD, OMP_STOPPED_FILE } from "./omp-guard.ts";
import { addSpend, sessionSpend } from "./omp-ledger.ts";
import { ompRpcCodec } from "./omp-rpc.ts";

/**
 * How long a paused node's call waits before it is deferred: `claude-code`'s
 * window (9 minutes), since a pause past it costs one resume of the session.
 */
export const OMP_HOLD_WINDOW_MS = HOLD_WINDOW_MS;

/** The switches every leg passes: `omp`'s own extras off. */
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
 * The `omp` arguments of one leg; the wiring's flags follow. The brief is no
 * argument: the codec sends it as the first `prompt` frame.
 */
export const ompArgs = (spec: SessionSpec): string[] => [
  "--mode",
  "rpc",
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
];

/**
 * The guard's reading of the hold endpoint's answer: `{}` lets the call run,
 * {@link HELD} refuses it as paused while the runner ends the leg.
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
        ...cap,
      ],
      env: {},
      release: () => {
        if (LEDGERS.get(spec.tools) === spent) LEDGERS.delete(spec.tools);
        hooks.signal.removeEventListener("abort", stop);
        files.remove();
        return Promise.resolve();
      },
    });
  },
});

/** A leg's codec, starting from the ledger as it is when the leg starts. */
const legCodec =
  (fixedHome: string | undefined) =>
  (spec: SessionSpec): Codec => {
    const spent =
      LEDGERS.get(spec.tools) ??
      ompFolders(homeOf(fixedHome, process.env)).spent;
    return ompRpcCodec(spec, {
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
    // Frames both ways; no `command.input`.
    protocol: legCodec(options.home),
    // Ork's tools go over the protocol; the runner's server serves `/hold` only.
    hostTools: true,
    mcp: wiring(options.home, windowMs, options.secretRoot),
    // A tool missing from the overlay's approval map asks Ork (`select`).
    permissions: { kind: "callback", denyByDefault: true },
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
