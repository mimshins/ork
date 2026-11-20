/**
 * @file The `omp` adapter's decoder and usage reader (RFC-026). `omp -p --mode
 *   json` prints one JSON object a line (measured on 18.22.2 in the RFC's
 *   capture legs): `session` (`id`, and `parentSession` on a fork), then
 *   `message_start`/`message_update`/`message_end` for each message (an
 *   assistant one carries its blocks, `usage` with `cost.total`, and
 *   `stopReason`), `tool_execution_start`/`_end` paired by `toolCallId`,
 *   `turn_end` and `agent_end` (which repeat messages already printed), and a
 *   `notice` from `cost-gate` when `--max-cost` is reached. There is no result
 *   line: the exit ends the leg (0 done, 3 the cost cap, 130 a SIGINT). Usage
 *   comes per model request, so the token cap stops a running leg, and each
 *   request's dollars go to Ork's ledger (`omp-ledger.ts`), since `--max-cost`
 *   counts the whole session. The decoder keeps none of `omp`'s or the
 *   provider's own fields (`credentialId`, `responseId`, `thinkingSignature`,
 *   `details`, `intent`, `requestControls`) nor the thinking text. Its `frame`
 *   and `end` also decode `omp --mode rpc`'s event frames, which have these
 *   shapes, for the rpc codec (`omp-rpc.ts`).
 */

import {
  endFor,
  type RuntimeEvent,
  type SessionEnd,
  type SessionSpec,
  type SessionUsage,
} from "@krapht/ork-core";

import type { Decoded, LegDecoder, UsageReader } from "../adapter.ts";
import { errorEnd } from "../session-end.ts";
import { isGuardRefusal } from "../tools/refusal.ts";
import { isBadArguments, orkMessage } from "../tools/tool.ts";
import { ompToolName } from "./omp-names.ts";
import { sumUsage } from "./open-code-events.ts";
import { addUsage, promptOf } from "./session-usage.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
};

/** The text of a `content` list's blocks of type `text`. */
const textOf = (content: unknown): string =>
  (Array.isArray(content) ? content : [])
    .filter(block => get(block, "type") === "text")
    .map(block => str(get(block, "text")))
    .join("\n");

/**
 * One assistant message's `usage`, as a session's of one request. `input`
 * excludes cache reads (measured); `cost.total` is `omp`'s catalogue price.
 */
export const ompRequestUsage = (usage: unknown): SessionUsage => {
  const request = {
    costUsd: num(get(get(usage, "cost"), "total")),
    inputTokens: num(get(usage, "input")),
    outputTokens: num(get(usage, "output")),
    cacheReadTokens: num(get(usage, "cacheRead")),
    cacheWriteTokens: num(get(usage, "cacheWrite")),
    turns: 1,
    durationMs: 0,
  };
  return { ...request, contextTokens: promptOf(request) };
};

/**
 * `omp` reports dollars; a leg's cost is already the session's total (it starts
 * from the ledger), so two legs combine as `claude-code`'s do.
 */
export const ompUsage: UsageReader = { dollars: true, combine: addUsage };

/** What a decoder of one leg starts from and writes to. */
export type OmpDecoderOptions = {
  /** What the session had spent before this leg, from Ork's ledger. */
  spentBefore?: number;
  /** Adds a request's (or a fork's inherited) dollars to the session's ledger. */
  record?: (sessionId: string, usd: number) => void;
};

/** A request's `stopReason` that ends neither in a tool call nor in an answer. */
const FINE_STOPS = new Set(["toolUse", "stop"]);

/** The exit codes `omp` gives the cost cap and an interrupted session. */
export const OMP_COST_CAP_EXIT = 3;
export const OMP_INTERRUPTED_EXIT = 130;
const COST_CAP = OMP_COST_CAP_EXIT;
const INTERRUPTED = OMP_INTERRUPTED_EXIT;

/**
 * A leg's decoder with two entry points for the rpc codec (`omp-rpc.ts`): a
 * frame already parsed, and the end as print mode's exit code would give it,
 * with words that explain a failure or the cost cap.
 */
export type OmpDecoder = LegDecoder & {
  frame: (message: unknown) => Decoded;
  end: (code: number | null, why?: string) => RuntimeEvent[];
};

/** The outcome's subtype for the ends that are not an error. */
const SUBTYPES: Readonly<Partial<Record<string, string>>> = {
  no_report: "success",
  budget_limit: "error_max_budget_usd",
};

/**
 * A decoder for one leg of an `omp` session: it starts the session at the
 * `session` line (a fork's names its new id), emits each assistant message's
 * text and each tool call, adds each request's usage, and gives the end at the
 * exit.
 */
export const ompDecoder = (
  spec: Pick<SessionSpec, "model" | "cwd" | "fork">,
  options: OmpDecoderOptions = {},
): OmpDecoder => {
  const began = Date.now();
  const spentBefore = options.spentBefore ?? 0;
  let sessionId = "";
  let text = "";
  let usage: SessionUsage = {
    costUsd: spentBefore,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
    durationMs: 0,
  };
  const started = new Set<string>();
  /** The cost gate's words, for a `budget_limit`'s detail. */
  let capped = "";
  /** Words of a request that ended badly, for a failed leg's detail. */
  const said: string[] = [];

  const record = (usd: number): void => {
    if (sessionId !== "" && usd > 0) options.record?.(sessionId, usd);
  };

  const called = (line: unknown, id: string): RuntimeEvent[] => {
    if (started.has(id)) return [];
    started.add(id);
    const name = str(get(line, "toolName"));
    const args = get(line, "args");
    return [
      {
        type: "tool.called",
        id,
        name: ompToolName(name) ?? name,
        input: isObject(args) ? args : {},
      },
    ];
  };

  const ended = (line: unknown, id: string): RuntimeEvent[] => {
    const body = textOf(get(get(line, "result"), "content"));
    const bad = isBadArguments(body);
    const isError = get(line, "isError") === true || bad;
    const message = isError ? orkMessage(body) : undefined;
    // The guard's refusal: a blocked call ends with its reason as the text.
    const refused = !bad && isError && isGuardRefusal(body);
    return [
      ...called(line, id),
      {
        type: "tool.result",
        id,
        isError,
        ...(bad ? { fault: "arguments" as const } : {}),
        ...(refused ? { fault: "refused" as const } : {}),
        ...(message === undefined ? {} : { message }),
      },
    ];
  };

  const assistant = (message: unknown): RuntimeEvent[] => {
    const stop = str(get(message, "stopReason"));
    // A SIGINT leaves an empty message with zero usage: no request to count.
    if (stop === "aborted") return [];
    if (!FINE_STOPS.has(stop)) {
      const why = [
        `stopReason: ${stop || "none"}`,
        str(get(message, "errorMessage")),
      ];
      said.push(why.filter(part => part !== "").join("\n"));
    }
    const request = ompRequestUsage(get(message, "usage"));
    usage = sumUsage(usage, request);
    record(request.costUsd);
    const words = textOf(get(message, "content"));
    if (words.trim() === "") return [];
    text = words;
    return [{ type: "assistant.text", text: words }];
  };

  /** The leg's end by its exit code; `null` for a failure no line explains. */
  const endOf = (code: number | null): SessionEnd | null => {
    if (code === 0) return endFor("no_report");
    if (code === COST_CAP) return endFor("budget_limit", {}, capped);
    if (code === INTERRUPTED) return endFor("interrupted", {}, said.join("\n"));
    return said.length > 0 ? errorEnd(said.join("\n"), "driver_crashed") : null;
  };

  const frame = (message: unknown): Decoded => {
    switch (get(message, "type")) {
      case "session": {
        sessionId = str(get(message, "id"));
        // A fork's own spend starts from its source's, as `--max-cost` does.
        // Keyed on the leg, not `parentSession`: a resumed fork's header may
        // carry it too, and its entry already holds the inherited spend.
        if (spec.fork === true) record(spentBefore);
        return {
          events: [
            {
              type: "session.started",
              sessionId,
              model: spec.model ?? "default",
              cwd: spec.cwd,
            },
          ],
        };
      }
      case "message_end": {
        const body = get(message, "message");
        if (get(body, "role") !== "assistant") return { events: [] };
        return { events: assistant(body), usage };
      }
      case "tool_execution_start": {
        return { events: called(message, str(get(message, "toolCallId"))) };
      }
      case "tool_execution_end": {
        return { events: ended(message, str(get(message, "toolCallId"))) };
      }
      case "notice": {
        if (get(message, "source") === "cost-gate") {
          capped = str(get(message, "message"));
        }
        return { events: [] };
      }
      default: {
        return { events: [] };
      }
    }
  };

  const end = (code: number | null, why = ""): RuntimeEvent[] => {
    if (why !== "" && code === COST_CAP) capped ||= why;
    else if (why !== "") said.push(why);
    const ending = endOf(code);
    // A failure no line explains is explained from stderr instead.
    if (ending === null) return [];
    const ok = code === 0;
    return [
      {
        type: "session.finished",
        outcome: {
          subtype: SUBTYPES[ending.kind] ?? "error_during_execution",
          end: ending,
          sessionId,
          report: null,
          text,
          usage: { ...usage, durationMs: Date.now() - began },
          errors: ok ? [] : [capped, ...said].filter(each => each !== ""),
        },
      },
    ];
  };

  return {
    decode: line => frame(parseLine(line)),
    exit: code => end(code),
    frame,
    end,
  };
};
