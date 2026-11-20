/**
 * @file What a `codex app-server` session's frames mean past its handshake (the
 *   protocol's findings are in `codex-rpc.ts`'s header): its items in `codex
 *   exec --json`'s shapes, the approvals Ork asks about and the server requests
 *   it refuses, one leg's usage out of the thread's running total, and the hook
 *   fence's reading of `hooks/list`.
 *
 *   - **Approvals** (server requests). `item/commandExecution/requestApproval` `{
 *     itemId, command?, kind?, ... }` becomes an `ask` for `Bash` with `{
 *     command }`; a `kind` other than `"command"` (`writeStdin`,
 *     `humanCommand`) or no command is declined.
 *     `item/fileChange/requestApproval` `{ itemId, grantRoot? }` carries **no
 *     changes** (the plan said it does): the paths and diffs are on the
 *     `fileChange` item's `item/started`, which the codec remembers by item id,
 *     and the ask is for `Edit` with `{ changes }`; one whose item it has not
 *     seen, or with `grantRoot` set (writes under a root for the session), is
 *     declined. An ask is paired by the request's own `id` (several requests
 *     can share one `itemId`). The answer is `{ decision: "accept" | "decline"
 *     }` only: never `acceptForSession`, never an execpolicy or network
 *     amendment (`proposedExecpolicyAmendment` is ignored).
 *   - **Other server requests** are refused at once, never served, so no turn
 *     waits on Ork: `item/tool/call` `{ contentItems, success: false }`,
 *     `mcpServer/elicitation/request` `{ action: "decline" }`,
 *     `item/permissions/requestApproval` `{ permissions: {}, scope: "turn" }`
 *     (an empty grant), the legacy `execCommandApproval` and
 *     `applyPatchApproval` `{ decision: "denied" }`, and every other method
 *     (`item/tool/requestUserInput`, whose answer cannot say no,
 *     `account/chatgptAuthTokens/refresh`, `attestation/generate`, anything
 *     new) a JSON-RPC error. Ork never handles a credential.
 */

import type { SessionUsage } from "@krapht/ork-core";

import type { Ask, Decision, DecodedFrame, Frame } from "../adapter.ts";
import { CODEX_TOOLS, codexTurnUsage } from "./codex-events.ts";

export type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const get = (value: unknown, key: string): unknown =>
  isObject(value) ? value[key] : undefined;

export const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** A field that is a list, or none. */
const list = (value: unknown, key: string): unknown[] => {
  const found: unknown = get(value, key);
  return Array.isArray(found) ? (found as unknown[]) : [];
};

/** The source of a hook Ork passed itself: a `-c hooks.*` key. */
const ORK_SOURCE = "sessionFlags";

/**
 * Why a leg's hooks refuse it, from `hooks/list`'s result `{ data: [{ hooks: [{
 * source, enabled, eventName, sourcePath }] }] }`: an enabled hook Ork did not
 * pass (the user's `config.toml`, a project's or the system's), which would run
 * untrusted beside Ork's once its trust is bypassed; or no `preToolUse` hook of
 * Ork's, so the node's rules would not bind. A hook without `enabled` counts as
 * enabled. `undefined` lets the leg go on.
 */
export const hookFence = (listed: unknown): string | undefined => {
  const hooks = list(listed, "data").flatMap(entry => list(entry, "hooks"));
  const foreign = hooks.filter(
    hook =>
      get(hook, "source") !== ORK_SOURCE && get(hook, "enabled") !== false,
  );
  if (foreign.length > 0) {
    const where = foreign.map(
      hook =>
        str(get(hook, "sourcePath")) || str(get(hook, "source")) || "unknown",
    );
    return `codex loads hooks Ork did not pass (${[...new Set(where)].join(", ")}), which would run untrusted beside Ork's hook; move them away to run this node on codex-app-server`;
  }
  const ours = hooks.some(
    hook =>
      get(hook, "source") === ORK_SOURCE &&
      get(hook, "eventName") === "preToolUse",
  );
  return ours
    ? undefined
    : "codex did not load Ork's PreToolUse hook, so the node's tool rules would not apply; the node is not started";
};

/** The `codex exec --json` item types of this protocol's camelCase ones. */
const ITEM_TYPES: Readonly<Record<string, string>> = {
  commandExecution: "command_execution",
  fileChange: "file_change",
  mcpToolCall: "mcp_tool_call",
  agentMessage: "agent_message",
};

/** An item in `codex exec --json`'s shape; a declined call failed. */
export const execItem = (item: unknown): Json => {
  const type = str(get(item, "type"));
  return {
    ...(isObject(item) ? item : {}),
    type: ITEM_TYPES[type] ?? type,
    ...(get(item, "status") === "declined"
      ? { status: "failed", declined: true }
      : {}),
  };
};

/** The answers to the server requests Ork never serves: each its own no. */
const REFUSALS: Readonly<Record<string, Json>> = {
  "item/tool/call": {
    contentItems: [{ type: "inputText", text: "Ork serves no host tools." }],
    success: false,
  },
  "mcpServer/elicitation/request": { action: "decline" },
  "item/permissions/requestApproval": { permissions: {}, scope: "turn" },
  execCommandApproval: { decision: "denied" },
  applyPatchApproval: { decision: "denied" },
};

/** The refusal of a server request; one with no `no` of its own, an error. */
const refusal = (id: number | string, method: string): Frame => {
  const result = REFUSALS[method];
  return result === undefined
    ? { id, error: { code: -32_601, message: `Ork does not serve ${method}` } }
    : { id, result };
};

const decline = (id: number | string): Frame => ({
  id,
  result: { decision: "decline" },
});

const COMMAND = "item/commandExecution/requestApproval";
const FILE_CHANGE = "item/fileChange/requestApproval";

/**
 * One leg's server requests: a command or file change Ork can describe becomes
 * an `ask` (paired by the request's own id), anything else is refused at once.
 */
export const codexApprovals = () => {
  /** The ids of the asks Ork has not answered, as Codex wrote them. */
  const asks = new Map<string, number | string>();
  /** The changes of each file change that started, by item id. */
  const changes = new Map<string, unknown>();

  const asking = (id: number | string, tool: string, args: Json) => {
    asks.set(String(id), id);
    return { events: [], ask: { id: String(id), tool, args } };
  };

  /** A command with its own command line, or a file change Ork saw start. */
  const approval = (
    id: number | string,
    method: string,
    params: unknown,
  ): DecodedFrame => {
    if (method === COMMAND) {
      const command = str(get(params, "command"));
      // `writeStdin` and `humanCommand` are no call Ork can name.
      const kind = get(params, "kind") ?? "command";
      return command === "" || kind !== "command"
        ? { events: [], write: [decline(id)] }
        : asking(id, CODEX_TOOLS["Bash"] ?? "Bash", { command });
    }
    const changed = changes.get(str(get(params, "itemId")));
    // A root asks for writes under it for the rest of the session.
    const root = get(params, "grantRoot") ?? null;
    return changed === undefined || root !== null
      ? { events: [], write: [decline(id)] }
      : asking(id, CODEX_TOOLS["apply_patch"] ?? "Edit", { changes: changed });
  };

  return {
    /** Keeps a file change's changes from its start: its approval has none. */
    item: (started: boolean, item: unknown): void => {
      if (get(item, "type") !== "fileChange") return;
      const id = str(get(item, "id"));
      if (started) changes.set(id, get(item, "changes"));
      else changes.delete(id);
    },
    serve: (frame: Frame): DecodedFrame => {
      const id = frame["id"];
      // An id Ork cannot echo back cannot be answered.
      if (typeof id !== "number" && typeof id !== "string") {
        return { events: [] };
      }
      const method = str(frame["method"]);
      return method === COMMAND || method === FILE_CHANGE
        ? approval(id, method, frame["params"])
        : { events: [], write: [refusal(id, method)] };
    },
    /** Accept or decline, once: never for the session, never an amendment. */
    answer: (ask: Ask, decision: Decision): Frame => {
      const id = asks.get(ask.id) ?? ask.id;
      asks.delete(ask.id);
      return {
        id,
        result: { decision: decision === "allow" ? "accept" : "decline" },
      };
    },
  };
};

/** A breakdown's fields, in the snake_case `codexTurnUsage` reads. */
const USAGE_FIELDS: Readonly<Record<string, string>> = {
  inputTokens: "input_tokens",
  cachedInputTokens: "cached_input_tokens",
  outputTokens: "output_tokens",
  cacheWriteInputTokens: "cache_write_input_tokens",
};

/**
 * One leg's usage: the thread's `total` less what it held before the leg's
 * first request (the first update's `total` less its `last`), so a resumed
 * thread's earlier legs are not counted again.
 */
export const codexLegUsage = () => {
  let before: Record<string, number> | undefined;
  let used: Json = {};
  return {
    /** The leg's usage at a `thread/tokenUsage/updated`'s `tokenUsage`. */
    update: (tokens: unknown): SessionUsage => {
      const total = get(tokens, "total");
      const last = get(tokens, "last");
      const base = (before ??= Object.fromEntries(
        Object.keys(USAGE_FIELDS).map(key => [
          key,
          num(get(total, key)) - num(get(last, key)),
        ]),
      ));
      used = Object.fromEntries(
        Object.entries(USAGE_FIELDS).map(([key, snake]) => [
          snake,
          Math.max(0, num(get(total, key)) - (base[key] ?? 0)),
        ]),
      );
      return codexTurnUsage(used);
    },
    /** The leg's usage so far, as `codex exec --json`'s `usage`. */
    used: (): Json => used,
  };
};
