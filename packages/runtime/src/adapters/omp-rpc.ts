/**
 * @file The `omp --mode rpc` codec (RFC-027): newline-delimited JSON both ways,
 *   not JSON-RPC. Ork writes `get_state` (the session id), `set_host_tools`
 *   (Ork's tools, on every leg), `prompt`, `steer` and `abort`, each with an
 *   `id` the tool answers with a `response` frame (`success`, `error`); it
 *   answers a `host_tool_call` with a `host_tool_result` of the same `id`, and
 *   an `extension_ui_request` of method `select` that offers `Approve` and
 *   `Deny` with an `extension_ui_response`, pairing it first in, first out with
 *   the calls that started and are not yet paired or ended (the request names
 *   no call). The tool's event frames have print mode's shapes, so
 *   `omp-events.ts` reads them, usage and Ork's ledger included. A
 *   `prompt_result` only marks a turn; the session ends at `session_settled`,
 *   as the last `prompt_result` says (`completed`, `aborted`, or an `error`
 *   whose `code` is `cost_cap`). Shapes measured in RFC-027's spike: `ready`
 *   (`maxFrameBytes`), `steer`'s `message`, `response`, the approval request
 *   and its `value` answer, `prompt_result`'s `status` and `sessionSettled`,
 *   `host_tool_call`'s `id`, `toolName` and `arguments`, and the result's
 *   `content`. Not measured, so chosen to match the rest: `prompt`'s `message`,
 *   `get_state`'s `data.sessionId`, `set_host_tools`' `tools`, the result's
 *   `isError`, the cancel answer (`cancelled: true`), an error's `message`, and
 *   how a chunked frame is marked.
 */

import type { SessionSpec } from "@krapht/ork-core";

import type {
  Codec,
  Decoded,
  DecodedFrame,
  Frame,
  FrameRequest,
} from "../adapter.ts";
import {
  OMP_COST_CAP_EXIT,
  OMP_INTERRUPTED_EXIT,
  ompDecoder,
  type OmpDecoderOptions,
} from "./omp-events.ts";
import { ompToolName } from "./omp-names.ts";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The frame limit `omp` 18.22.2 reported at `ready`. */
export const OMP_MAX_FRAME_BYTES = 1_048_576;

/** The answers Ork gives an approval; never "Approve <tool> for this session". */
const APPROVE = "Approve";
const DENY = "Deny";

/**
 * What a leg after a pause's deferral (`LegContext.deferredFor`) sends instead
 * of the spec's prompt: the leg before it ended at a pause with the held call
 * not run.
 */
export const OMP_PAUSE_MESSAGE =
  "Ork paused this node before your last tool call ran, so it did not run. The node has continued: make the same call again now, then go on with the task.";

/**
 * What a leg after a slot's deferral sends instead: the held call waited for a
 * free `heavy` slot past the hold window, and the runner has taken it since.
 */
export const OMP_SLOT_MESSAGE =
  "Your last tool call did not run: it waited for a free slot for heavy commands (the project's `heavy` rule), and none came free in time. The slot is now taken for you: make the same call again now, then go on with the task.";

/** Whether `frame` is one piece of a frame over the tool's limit. */
// shortcut: no reassembly, upgrade once a real chunked frame is captured.
const isChunk = (frame: Frame): boolean =>
  str(frame["type"]).includes("chunk") ||
  "chunk" in frame ||
  frame["chunked"] === true;

/** The answer that closes a request Ork cannot read: never an approval. */
const cancel = (id: string): Frame => ({
  type: "extension_ui_response",
  id,
  cancelled: true,
});

/** A tool call that started and has not ended: what an approval is about. */
type Call = { id: string; tool: string; args: Json };

/**
 * A fresh codec for one leg of an `omp --mode rpc` session; `options` is the
 * ledger the leg's usage adds to, as for print mode's decoder.
 */
export const ompRpcCodec = (
  spec: Pick<SessionSpec, "model" | "cwd" | "fork">,
  options: OmpDecoderOptions = {},
): Codec & Required<Pick<Codec, "callResult">> => {
  const events = ompDecoder(spec, options);
  let count = 0;
  const request = (frame: Frame): FrameRequest => {
    count += 1;
    const id = `ork-${String(count)}`;
    return { id, frame: { id, ...frame } };
  };
  let stateId = "";
  let started = false;
  let limit = OMP_MAX_FRAME_BYTES;
  /** Calls started and not yet paired or ended, oldest first. */
  const calls: Call[] = [];
  /** The last `prompt_result`, which the settled session ends with. */
  let result: unknown;

  /** The session's start, once, at the id `get_state` gives. */
  const begin = (sessionId: string): Decoded => {
    if (started || sessionId === "") return { events: [] };
    started = true;
    return events.frame({ type: "session", id: sessionId });
  };

  const reply = (frame: Frame): DecodedFrame => {
    const id = str(frame["id"]);
    if (id === "") return { events: [] };
    const failed = frame["success"] === false || frame["error"] !== undefined;
    if (failed) {
      const error =
        str(frame["error"]) ||
        str(get(frame["error"], "message")) ||
        `${str(frame["command"]) || "a request"} failed`;
      return { events: [], reply: { id, error } };
    }
    const said =
      id === stateId
        ? begin(str(get(frame["data"], "sessionId")))
        : { events: [] };
    return { ...said, reply: { id } };
  };

  /**
   * An approval of the oldest unpaired call; anything else it cannot read is
   * cancelled, and takes no call.
   */
  const select = (frame: Frame): DecodedFrame => {
    const id = str(frame["id"]);
    if (id === "") return { events: [] };
    const offered = frame["options"];
    const labels = Array.isArray(offered) ? offered : [];
    if (!labels.includes(APPROVE) || !labels.includes(DENY)) {
      return { events: [], write: [cancel(id)] };
    }
    const about = calls.shift();
    if (about === undefined) return { events: [], write: [cancel(id)] };
    return { events: [], ask: { id, tool: about.tool, args: about.args } };
  };

  /** The session's end, as the last prompt's result says. */
  const settle = (): Decoded => {
    const error = get(result, "error");
    const code = str(get(error, "code"));
    const why = str(get(error, "message")) || str(error) || code;
    if (code === "cost_cap") {
      return { events: events.end(OMP_COST_CAP_EXIT, why) };
    }
    if (str(get(result, "status")) === "aborted") {
      return { events: events.end(OMP_INTERRUPTED_EXIT) };
    }
    if (str(get(result, "status")) === "error" || error !== undefined) {
      return { events: events.end(1, why || "omp's prompt ended in an error") };
    }
    return { events: events.end(0) };
  };

  const decode = (frame: Frame): DecodedFrame => {
    if (isChunk(frame)) {
      return {
        events: [],
        fail: `omp sent a frame in chunks, over its ${String(limit)}-byte frame limit, which Ork cannot read yet`,
      };
    }
    switch (frame["type"]) {
      case "ready": {
        const max = frame["maxFrameBytes"];
        if (typeof max === "number" && max > 0) limit = max;
        return { events: [], ready: true };
      }
      case "response": {
        return reply(frame);
      }
      case "session": {
        return begin(str(frame["id"]));
      }
      case "tool_execution_start": {
        const name = str(frame["toolName"]);
        const args = frame["args"];
        calls.push({
          id: str(frame["toolCallId"]),
          tool: ompToolName(name) ?? name,
          args: isObject(args) ? args : {},
        });
        return events.frame(frame);
      }
      case "tool_execution_end": {
        const ended = calls.findIndex(
          each => each.id === str(frame["toolCallId"]),
        );
        if (ended !== -1) calls.splice(ended, 1);
        return events.frame(frame);
      }
      case "extension_ui_request": {
        // Other methods (`setWidget`, …) need no answer.
        return frame["method"] === "select" ? select(frame) : { events: [] };
      }
      case "host_tool_call": {
        const id = str(frame["id"]);
        if (id === "") return { events: [] };
        const args = frame["arguments"];
        return {
          events: [],
          call: {
            id,
            tool: str(frame["toolName"]),
            args: isObject(args) ? args : {},
          },
        };
      }
      case "prompt_result": {
        result = frame;
        return { events: [] };
      }
      case "session_settled": {
        return settle();
      }
      default: {
        return events.frame(frame);
      }
    }
  };

  return {
    open: (legSpec: SessionSpec, leg) => {
      const state = request({ type: "get_state" });
      stateId = state.id;
      // A leg after a deferral asks for the held call again; any other leg,
      // a plain resume or a fork included, sends its own prompt.
      const message =
        leg.deferredFor === undefined
          ? legSpec.prompt
          : leg.deferredFor === "slot"
            ? OMP_SLOT_MESSAGE
            : OMP_PAUSE_MESSAGE;
      // Every leg offers Ork's tools again, a resumed or forked one included.
      const tools =
        leg.hostTools === undefined
          ? []
          : [
              request({
                type: "set_host_tools",
                tools: leg.hostTools.map(tool => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                })),
              }),
            ];
      return [state, ...tools, request({ type: "prompt", message })];
    },
    decode,
    message: text => request({ type: "steer", message: text }),
    interrupt: () => request({ type: "abort" }),
    answer: (ask, decision) => ({
      type: "extension_ui_response",
      id: ask.id,
      value: decision === "allow" ? APPROVE : DENY,
    }),
    callResult: (hostCall, toolResult) => ({
      type: "host_tool_result",
      id: hostCall.id,
      result: toolResult,
    }),
  };
};
