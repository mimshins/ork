/**
 * @file The `codex app-server` codec (RFC-027, the `codex-app-server` driver):
 *   JSON-RPC 2.0 over stdio, one JSON object a line both ways. Every name below
 *   comes from `codex app-server generate-json-schema` of codex-cli 0.169.0
 *   (the stable bundle, without `--experimental`), read as data and never run;
 *   no model was called, so every shape is unmeasured (`proven: false`). Names
 *   not in the schema are marked **guessed**.
 *
 *   - **Wire.** The envelopes carry no `jsonrpc` field: a request is `{ id,
 *     method, params }` (`id` a string or an integer), a notification `{
 *     method, params }`, a reply `{ id, result }` or `{ id, error: { code,
 *     message } }`. Codex sends nothing first: Ork opens with `initialize`, so
 *     the codec is `readyAtSpawn`.
 *   - **Handshake**, chained through `decode`'s `write`: `initialize` `{
 *     clientInfo, capabilities: { experimentalApi: false } }` (every method
 *     used is in the stable bundle); at its reply the `initialized`
 *     notification and `thread/start` (a first leg), `thread/resume` `{
 *     threadId }` (a resumed leg) or `thread/fork` `{ threadId }` (a fork),
 *     each with `cwd`, `model`, `sandbox`, `approvalPolicy: "on-request"`,
 *     `approvalsReviewer: "user"`, the adapter's `config` and, on a first leg
 *     only, `developerInstructions`; at the thread's reply `session.started`
 *     with `thread.id` as the session id (`thread.sessionId` is a separate
 *     field, unmeasured whether it differs) and `turn/start` `{ threadId,
 *     input: [{ type: "text", text }], effort }`. The effort is on
 *     `turn/start`, not on the thread (the plan said thread). An error reply to
 *     any of these ends the leg failed (`fail`).
 *   - **Hook fence** (the adapter's `fence`). Between `initialize`'s reply and
 *     the thread, `hooks/list` `{ cwds: [cwd] }`; its reply `{ data: [{ hooks:
 *     [{ source, enabled, eventName, sourcePath }] }] }` ends the leg failed
 *     when an enabled hook's `source` is not `sessionFlags` (Ork's `-c` key) or
 *     no `preToolUse` hook of Ork's is listed (`hookFence`). Whether the list
 *     before a thread holds every hook the thread runs is unmeasured.
 *   - **Approval policy.** `"untrusted"` is in the schema but the binary refuses
 *     it ("is no longer supported"), so the policy is `"on-request"`: Codex
 *     asks the host for what the sandbox would refuse and grants nothing
 *     itself. `approvalsReviewer: "user"` is sent too, so that a user config's
 *     `auto_review` or `guardian_subagent` never routes an approval to a
 *     model.
 *   - **Turn.** `turn/started` `{ threadId, turn: { id, status } }` gives the
 *     turn id `turn/steer` and `turn/interrupt` need, and signals `turn` (the
 *     codec `waitsForTurn`: a steer before it is refused with "no active turn
 *     to steer").
 *   - **Message.** `turn/steer` `{ threadId, expectedTurnId, input }`, reply `{
 *     turnId }`. Whether it reaches the model before a running command ends is
 *     unmeasured.
 *   - **Interrupt.** `turn/interrupt` `{ threadId, turnId }`, reply `{}`; the end
 *     comes as `turn/completed` with `turn.status: "interrupted"`.
 *   - **End.** `turn/completed` `{ threadId, turn }` ends the session (no wake-up
 *     follows it, unlike `omp`'s `session_settled`), with the ends `codex`
 *     gives (`codex-events.ts`, fed this leg's frames in `codex exec --json`'s
 *     shapes): `completed` as an exit 0 (the report comes through Ork's
 *     `report` tool), `interrupted` as Codex's interrupt exit, `failed` as a
 *     `turn.failed` with `turn.error.message`, read by `classifyProviderError`.
 *     An `error` notification with `willRetry: false` adds its words to a
 *     failure's detail; one with `willRetry: true` is a warning and dropped.
 *   - **Items.** `item/started` and `item/completed` `{ item }`, whose `type` is
 *     camelCase (`commandExecution`, `fileChange`, `mcpToolCall`,
 *     `agentMessage`) where `codex exec --json`'s is snake_case; they are
 *     renamed and read by the `codex` decoder, so tool names are `CODEX_TOOLS`'
 *     words (`Bash`, `Edit`, `mcp__<server>__<tool>`). A `declined` status
 *     (only on this protocol) reads as `failed`.
 *   - **Approvals and other server requests**: see `codex-app-server-events.ts`'
 *     header.
 *   - **Usage.** `thread/tokenUsage/updated` `{ tokenUsage: { total, last } }`,
 *     each `{ inputTokens, cachedInputTokens, outputTokens,
 *     cacheWriteInputTokens, ... }` (camelCase). `total` is the thread's
 *     running sum and may hold a resumed thread's earlier legs, so the leg's
 *     usage is `total` less what it held before the leg's first request (the
 *     first update's `total` less its `last`); that `last` is one request's
 *     usage is unmeasured. No price.
 *   - **Ignored.** A notification of another thread (a sub-agent's) and every
 *     other one (`thread/started`, deltas, `hook/*`) yields nothing.
 *     **Guessed** (not in the schema or not seen): every JSON-RPC error `code`
 *     (only -32600 was seen; Ork answers -32601), the id formats, the meaning
 *     of `last`, and whether a steer waits for a running command. The adapter's
 *     `config` (e.g. `bypass_hook_trust`, itself guessed) goes into the thread
 *     requests as given.
 */

import type { SessionSpec } from "@krapht/ork-core";

import type { Codec, DecodedFrame, Frame, FrameRequest } from "../adapter.ts";
import {
  codexApprovals,
  codexLegUsage,
  execItem,
  get,
  hookFence,
  type Json,
  str,
} from "./codex-app-server-events.ts";
import { CODEX_INTERRUPTED_EXIT, codexDecoder } from "./codex-events.ts";

/** What the adapter decides for a leg; the rest comes from its spec. */
export type CodexRpcOptions = {
  /** The leg's sandbox, from the node's rules (`codexSandbox`). */
  sandbox: "read-only" | "workspace-write";
  /** The reasoning effort in Codex's words (`xhigh` for Ork's `max`). */
  effort?: string;
  /** `config` overrides of every thread request, e.g. the hook's trust. */
  config?: Json;
  /** Refuse the leg by `hookFence` (`hooks/list` before the thread). */
  fence?: boolean;
};

/** A codec, and whether its leg finished a tool call (the hook's canary). */
export type CodexRpcCodec = Codec & { toolsRan: () => boolean };

const APPROVAL_POLICY = "on-request";

const text = (words: string) => [{ type: "text", text: words }];

/**
 * A fresh codec for one leg of a `codex app-server` session: `spec` names the
 * model and folder its events carry, `options` what the adapter decided.
 */
export const codexRpcCodec = (
  spec: Pick<SessionSpec, "model" | "cwd">,
  options: CodexRpcOptions,
): CodexRpcCodec => {
  const decoder = codexDecoder(spec);
  let count = 0;
  /** The handshake's requests Ork wrote, by id, with their method. */
  const handshake = new Map<string, string>();
  const request = (method: string, params: Json): FrameRequest => {
    count += 1;
    const id = `ork-${String(count)}`;
    return { id, frame: { id, method, params } };
  };
  /** A handshake request after `open`, written back by `decode`. */
  const next = (method: string, params: Json): Frame => {
    const { id, frame } = request(method, params);
    handshake.set(id, method);
    return frame;
  };
  let legSpec: SessionSpec | undefined;
  let threadId = "";
  let turnId = "";
  const approvals = codexApprovals();
  const usage = codexLegUsage();

  const thread = (leg: SessionSpec): Frame => {
    const method =
      leg.resume === undefined
        ? "thread/start"
        : leg.fork === true
          ? "thread/fork"
          : "thread/resume";
    return next(method, {
      ...(leg.resume === undefined ? {} : { threadId: leg.resume }),
      cwd: leg.cwd,
      ...(leg.model === undefined ? {} : { model: leg.model }),
      sandbox: options.sandbox,
      approvalPolicy: APPROVAL_POLICY,
      approvalsReviewer: "user",
      // A resumed or forked thread keeps its instructions, as on `codex`.
      ...(leg.resume === undefined && leg.systemAppend !== ""
        ? { developerInstructions: leg.systemAppend }
        : {}),
      ...(options.config === undefined ? {} : { config: options.config }),
    });
  };

  const reply = (frame: Frame): DecodedFrame => {
    const raw = frame["id"];
    if (typeof raw !== "number" && typeof raw !== "string") {
      return { events: [] };
    }
    const id = String(raw);
    const step = handshake.get(id);
    handshake.delete(id);
    if (frame["error"] !== undefined) {
      const error =
        str(get(frame["error"], "message")) || str(frame["error"]) || "error";
      const answered: DecodedFrame = { events: [], reply: { id, error } };
      return step === undefined
        ? answered
        : { ...answered, fail: `codex refused ${step}: ${error}` };
    }
    const result = frame["result"];
    if (step === "initialize" && legSpec !== undefined) {
      const after =
        options.fence === true
          ? next("hooks/list", { cwds: [legSpec.cwd] })
          : thread(legSpec);
      return {
        events: [],
        reply: { id },
        write: [{ method: "initialized" }, after],
      };
    }
    if (step === "hooks/list" && legSpec !== undefined) {
      const refused = hookFence(result);
      return refused === undefined
        ? { events: [], reply: { id }, write: [thread(legSpec)] }
        : { events: [], reply: { id }, fail: refused };
    }
    if (step?.startsWith("thread/") === true && legSpec !== undefined) {
      threadId = str(get(get(result, "thread"), "id"));
      if (threadId === "") {
        return { events: [], fail: `codex's ${step} named no thread` };
      }
      const started = decoder.frame({
        type: "thread.started",
        thread_id: threadId,
      });
      const turn = next("turn/start", {
        threadId,
        input: text(legSpec.prompt),
        ...(options.effort === undefined ? {} : { effort: options.effort }),
      });
      return { ...started, reply: { id }, write: [turn] };
    }
    return { events: [], reply: { id } };
  };

  /** The session's end, as the turn's status says. */
  const end = (turn: unknown): DecodedFrame => {
    decoder.frame({ type: "turn.completed", usage: usage.used() });
    const status = str(get(turn, "status"));
    if (status === "completed") return { events: decoder.exit(0) };
    if (status === "interrupted") {
      return { events: decoder.exit(CODEX_INTERRUPTED_EXIT) };
    }
    const message =
      str(get(get(turn, "error"), "message")) ||
      `codex ended the turn as ${status || "unknown"}`;
    decoder.frame({ type: "turn.failed", error: { message } });
    return { events: decoder.exit(1) };
  };

  const notified = (method: string, params: unknown): DecodedFrame => {
    const from = str(get(params, "threadId"));
    if (from !== "" && threadId !== "" && from !== threadId)
      return { events: [] };
    switch (method) {
      case "turn/started": {
        turnId = str(get(get(params, "turn"), "id"));
        return turnId === "" ? { events: [] } : { events: [], turn: true };
      }
      case "item/started":
      case "item/completed": {
        const item = get(params, "item");
        const started = method === "item/started";
        approvals.item(started, item);
        return decoder.frame({
          type: started ? "item.started" : "item.completed",
          item: execItem(item),
        });
      }
      case "thread/tokenUsage/updated": {
        return { events: [], usage: usage.update(get(params, "tokenUsage")) };
      }
      case "error": {
        // A provider error Codex retries is a warning, not an end.
        if (get(params, "willRetry") === true) return { events: [] };
        const message = str(get(get(params, "error"), "message"));
        return decoder.frame({ type: "error", message });
      }
      case "turn/completed": {
        return end(get(params, "turn"));
      }
      default: {
        return { events: [] };
      }
    }
  };

  const decode = (frame: Frame): DecodedFrame => {
    const method = frame["method"];
    if (typeof method !== "string") return reply(frame);
    return "id" in frame
      ? approvals.serve(frame)
      : notified(method, frame["params"]);
  };

  return {
    open: leg => {
      legSpec = leg;
      const initialize = request("initialize", {
        clientInfo: { name: "ork", version: "0" },
        capabilities: { experimentalApi: false },
      });
      handshake.set(initialize.id, "initialize");
      return [initialize];
    },
    decode,
    message: words =>
      request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        input: text(words),
      }),
    interrupt: () => request("turn/interrupt", { threadId, turnId }),
    answer: approvals.answer,
    readyAtSpawn: true,
    waitsForTurn: true,
    toolsRan: decoder.toolsRan,
  };
};
