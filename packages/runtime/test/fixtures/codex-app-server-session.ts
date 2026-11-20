/**
 * @file Recorded-shape frames of a `codex app-server` session (RFC-027, plan
 *   task 6), for the `codex-app-server` codec's tests. Every method and field
 *   name below comes from `codex app-server generate-json-schema` of codex-cli
 *   0.169.0 (stable bundle, without `--experimental`), read as data and never
 *   run; the values are made up. No model was called. The protocol's findings
 *   (wire, handshake, approval policy, turn, steer, interrupt, end, items,
 *   approvals, refused requests, usage, what is guessed) are in
 *   `packages/runtime/src/adapters/codex-rpc.ts`'s header; the hook and flag
 *   findings the adapter needs stay here.
 *
 *   - **Hooks.** `hook/started` and `hook/completed` notifications `{
 *     threadId, turnId?, run: { id, eventName: "preToolUse" | ..., source:
 *     "sessionFlags" | "user" | "project" | "system" | ..., status: "running"
 *     | "completed" | "failed" | "blocked" | "stopped", entries, ... } }`, and
 *     a `hooks/list` client request `{ cwds, threadId? }` replying `{ data: [{
 *     cwd, hooks: [{ key, eventName, source, sourcePath, enabled, trustStatus:
 *     "managed" | "untrusted" | "trusted" | "modified", ... }], errors,
 *     warnings }] }`.
 *
 *   Flags (`codex app-server --help`, `--strict-config --print-startup-config`,
 *   which loads the config and exits without serving):
 *
 *   - `app-server` takes `-c key=value`, `--enable`, `--disable`,
 *     `--strict-config`, `--listen` (default `stdio://`), `--stdio`. Accepted
 *     under `--strict-config`: `hooks.PreToolUse=[...]`, `mcp_servers.ork.url`,
 *     `mcp_servers.ork.bearer_token_env_var`,
 *     `shell_environment_policy.exclude`, `sandbox_mode`, `approval_policy =
 *     "on-request"` and the granular table, `--disable plugins`, `apps`,
 *     `remote_plugin`.
 *   - Not on `app-server` (all `exec`-only): `--json`, `--ignore-user-config`,
 *     `--ignore-rules`, `--dangerously-bypass-hook-trust`, `-s/--sandbox`,
 *     `-m`. `bypass_hook_trust` is refused as a `-c` key ("unknown
 *     configuration field"); the binary's strings hold "`bypass_hook_trust`
 *     override must be a boolean" beside "session flags must be a table" in
 *     app-server code, so it is likely a key of `thread/start`'s `config`
 *     object (**guessed** from the binary, not run).
 *
 *   Hook verdict: the hook itself can be carried (`-c hooks.PreToolUse=...` is
 *   accepted; its source would be `sessionFlags`). Trusting it has no flag;
 *   `config: { bypass_hook_trust: true }` on `thread/start`, `thread/resume`
 *   and `thread/fork` is the guessed way. If that guess is wrong, the hook is
 *   untrusted, never runs, and the canary ends the first tool call's leg with
 *   `HOOK_DID_NOT_RUN` (fail closed, but at the first tool, not at `wire`).
 *   The weaker part is the user's config: with no `--ignore-user-config` or
 *   `--ignore-rules`, `$CODEX_HOME/config.toml` (its MCP servers, profile,
 *   `[hooks]` tables, approvals reviewer) and the execpolicy `.rules` files
 *   load. With trust bypassed, hooks in the user's `config.toml` would run
 *   untrusted beside Ork's, which `exec`'s `--ignore-user-config` prevents.
 *   Checking only `hooks.json` (as `codex` does) is not enough here. One
 *   in-protocol fence: after `initialize`, call `hooks/list` for the cwd and
 *   refuse the leg if any enabled hook's `source` is not `sessionFlags`; Ork
 *   never reads the file. Which fence `wire` uses is a design decision for
 *   the adapter task, not settled here.
 *
 *   Differences from the plan's wording: the request names above are exact;
 *   the file-change approval carries no change fields (see Approvals); the
 *   effort goes on `turn/start`, not `thread/start`; `"untrusted"` is refused,
 *   so the policy is `"on-request"`; envelopes have no `jsonrpc` field;
 *   `approvalsReviewer: "user"` is needed besides the policy.
 *
 *   Guessed (not in the schema): the `config.bypass_hook_trust` route; every
 *   JSON-RPC error `code` (only -32600, from `--print-startup-config`'s config
 *   error, was seen); the id formats (thread, turn, item ids here are made
 *   up); whether a steer reaches the model before a running command ends.
 */

/** A request either side sends. */
export type RpcRequest = {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

/** A notification either side sends. */
export type RpcNotification = {
  method: string;
  params?: Record<string, unknown>;
};

/** A reply, with its result or its error. */
export type RpcReply =
  | { id: number | string; result: Record<string, unknown> }
  | {
      id: number | string;
      error: { code: number; message: string; data?: unknown };
    };

export const THREAD_ID = "019a7c2e-0000-7000-8000-00000000a001";
export const FORKED_THREAD_ID = "019a7c2e-0000-7000-8000-00000000a002";
export const TURN_ID = "turn-1";
export const COMMAND_ITEM_ID = "item-cmd-1";
export const FILE_ITEM_ID = "item-file-1";
export const REPORT_ITEM_ID = "item-report-1";
export const CWD = "/work";

// Client requests and their replies. Ork's ids are the codec's own; these use 1-4.

/** What Ork sends first. */
export const INITIALIZE: RpcRequest = {
  id: 1,
  method: "initialize",
  params: {
    clientInfo: { name: "ork", version: "0.0.0" },
    capabilities: { experimentalApi: false },
  },
};

export const INITIALIZE_REPLY: RpcReply = {
  id: 1,
  result: {
    codexHome: "/home/user/.codex",
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex_app_server/0.169.0",
  },
};

/** The client notification after the `initialize` reply. */
export const INITIALIZED: RpcNotification = { method: "initialized" };

/** A first leg's thread; `config.bypass_hook_trust` is guessed. */
export const THREAD_START: RpcRequest = {
  id: 2,
  method: "thread/start",
  params: {
    cwd: CWD,
    model: "gpt-5.1-codex",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    developerInstructions: "# Ork",
    config: { bypass_hook_trust: true },
  },
};

const thread = (id: string) => ({
  id,
  sessionId: id,
  cliVersion: "0.169.0",
  createdAt: 1_763_700_000,
  updatedAt: 1_763_700_000,
  cwd: CWD,
  ephemeral: false,
  modelProvider: "openai",
  preview: "",
  projectId: null,
  source: "appServer",
  status: { type: "idle" },
  turns: [],
});

const threadReply = (id: number, threadId: string): RpcReply => ({
  id,
  result: {
    thread: thread(threadId),
    model: "gpt-5.1-codex",
    modelProvider: "openai",
    cwd: CWD,
    sandbox: {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
    },
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    reasoningEffort: "medium",
  },
});

export const THREAD_START_REPLY: RpcReply = threadReply(2, THREAD_ID);

/** A resumed leg: `thread/resume` by id, the same overrides as a start. */
export const THREAD_RESUME: RpcRequest = {
  id: 2,
  method: "thread/resume",
  params: {
    threadId: THREAD_ID,
    cwd: CWD,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    config: { bypass_hook_trust: true },
  },
};

export const THREAD_RESUME_REPLY: RpcReply = threadReply(2, THREAD_ID);

export const THREAD_FORK: RpcRequest = {
  id: 2,
  method: "thread/fork",
  params: {
    threadId: THREAD_ID,
    cwd: CWD,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    config: { bypass_hook_trust: true },
  },
};

export const THREAD_FORK_REPLY: RpcReply = threadReply(2, FORKED_THREAD_ID);

export const THREAD_STARTED: RpcNotification = {
  method: "thread/started",
  params: { thread: thread(THREAD_ID) },
};

export const TURN_START: RpcRequest = {
  id: 3,
  method: "turn/start",
  params: {
    threadId: THREAD_ID,
    input: [{ type: "text", text: "Do the task" }],
    effort: "medium",
  },
};

const turn = (
  status: "inProgress" | "completed" | "interrupted" | "failed",
  error?: Record<string, unknown>,
) => ({
  id: TURN_ID,
  status,
  items: [],
  ...(error === undefined ? {} : { error }),
});

export const TURN_START_REPLY: RpcReply = {
  id: 3,
  result: { turn: turn("inProgress") },
};

export const TURN_STARTED: RpcNotification = {
  method: "turn/started",
  params: { threadId: THREAD_ID, turn: turn("inProgress") },
};

/** A message mid-turn: needs the running turn's id. */
export const TURN_STEER: RpcRequest = {
  id: 4,
  method: "turn/steer",
  params: {
    threadId: THREAD_ID,
    expectedTurnId: TURN_ID,
    input: [{ type: "text", text: "Also update the docs" }],
  },
};

export const TURN_STEER_REPLY: RpcReply = {
  id: 4,
  result: { turnId: TURN_ID },
};

/** A steer with no running turn; the code is guessed, the text the binary's. */
export const TURN_STEER_NO_TURN: RpcReply = {
  id: 4,
  error: { code: -32600, message: "no active turn to steer" },
};

export const TURN_INTERRUPT: RpcRequest = {
  id: 5,
  method: "turn/interrupt",
  params: { threadId: THREAD_ID, turnId: TURN_ID },
};

export const TURN_INTERRUPT_REPLY: RpcReply = { id: 5, result: {} };

// Items.

const COMMAND = {
  type: "commandExecution",
  id: COMMAND_ITEM_ID,
  command: "pnpm test",
  cwd: CWD,
  commandActions: [{ type: "unknown", command: "pnpm test" }],
  source: "agent",
};

export const COMMAND_STARTED: RpcNotification = {
  method: "item/started",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    startedAtMs: 1_763_700_001_000,
    item: { ...COMMAND, status: "inProgress" },
  },
};

export const COMMAND_COMPLETED: RpcNotification = {
  method: "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    completedAtMs: 1_763_700_002_000,
    item: {
      ...COMMAND,
      status: "completed",
      exitCode: 0,
      aggregatedOutput: "ok\n",
      durationMs: 1000,
    },
  },
};

/** A command the human declined. */
export const COMMAND_DECLINED: RpcNotification = {
  method: "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    completedAtMs: 1_763_700_002_000,
    item: { ...COMMAND, status: "declined" },
  },
};

const FILE_CHANGE = {
  type: "fileChange",
  id: FILE_ITEM_ID,
  changes: [
    {
      path: "/work/README.md",
      kind: { type: "update", move_path: null },
      diff: "@@ -1 +1 @@\n-old\n+new\n",
    },
  ],
};

/** The only frame naming the change's paths: its approval does not. */
export const FILE_CHANGE_STARTED: RpcNotification = {
  method: "item/started",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    startedAtMs: 1_763_700_003_000,
    item: { ...FILE_CHANGE, status: "inProgress" },
  },
};

export const FILE_CHANGE_COMPLETED: RpcNotification = {
  method: "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    completedAtMs: 1_763_700_004_000,
    item: { ...FILE_CHANGE, status: "completed" },
  },
};

/** Ork's `report` tool on its MCP server. */
export const REPORT_COMPLETED: RpcNotification = {
  method: "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    completedAtMs: 1_763_700_005_000,
    item: {
      type: "mcpToolCall",
      id: REPORT_ITEM_ID,
      server: "ork",
      tool: "report",
      arguments: { status: "done", summary: "Did it" },
      status: "completed",
      result: { content: [{ type: "text", text: "recorded" }] },
    },
  },
};

export const AGENT_MESSAGE_COMPLETED: RpcNotification = {
  method: "item/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    completedAtMs: 1_763_700_005_500,
    item: { type: "agentMessage", id: "item-msg-1", text: "Done." },
  },
};

/** A delta the codec ignores (no event per frame). */
export const AGENT_MESSAGE_DELTA: RpcNotification = {
  method: "item/agentMessage/delta",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: "item-msg-1",
    delta: "Do",
  },
};

// Approvals: server requests the codec turns into an `ask`.

export const COMMAND_APPROVAL: RpcRequest = {
  id: 100,
  method: "item/commandExecution/requestApproval",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: COMMAND_ITEM_ID,
    startedAtMs: 1_763_700_001_000,
    approvalId: null,
    kind: "command",
    command: "pnpm test",
    cwd: CWD,
    commandActions: [{ type: "unknown", command: "pnpm test" }],
    reason: "needs network access",
    proposedExecpolicyAmendment: ["pnpm", "test"],
  },
};

export const FILE_CHANGE_APPROVAL: RpcRequest = {
  id: 101,
  method: "item/fileChange/requestApproval",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: FILE_ITEM_ID,
    startedAtMs: 1_763_700_003_000,
    reason: null,
    grantRoot: null,
  },
};

/** A file change asking for writes under a root for the whole session. */
export const FILE_CHANGE_GRANT_ROOT: RpcRequest = {
  id: 102,
  method: "item/fileChange/requestApproval",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: FILE_ITEM_ID,
    startedAtMs: 1_763_700_003_000,
    reason: "write outside the workspace",
    grantRoot: "/etc",
  },
};

/** The only answers Ork gives an approval: never `acceptForSession`. */
export const accept = (id: number | string): RpcReply => ({
  id,
  result: { decision: "accept" },
});

export const decline = (id: number | string): RpcReply => ({
  id,
  result: { decision: "decline" },
});

// Server requests the codec never serves, and the refusal each gets.

export const TOOL_CALL: RpcRequest = {
  id: 200,
  method: "item/tool/call",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    callId: "call-1",
    tool: "lookup",
    namespace: null,
    arguments: { q: "x" },
  },
};

export const TOOL_CALL_REFUSED: RpcReply = {
  id: 200,
  result: {
    contentItems: [{ type: "inputText", text: "Ork serves no host tools." }],
    success: false,
  },
};

export const USER_INPUT: RpcRequest = {
  id: 201,
  method: "item/tool/requestUserInput",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: "item-ask-1",
    isBlocking: true,
    questions: [{ id: "q1", header: "Pick", question: "Which one?" }],
  },
};

export const ELICITATION: RpcRequest = {
  id: 202,
  method: "mcpServer/elicitation/request",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    serverName: "other",
    mode: "form",
    message: "Your token?",
    requestedSchema: { type: "object", properties: {} },
  },
};

export const ELICITATION_REFUSED: RpcReply = {
  id: 202,
  result: { action: "decline" },
};

export const PERMISSIONS: RpcRequest = {
  id: 203,
  method: "item/permissions/requestApproval",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    itemId: "item-perm-1",
    startedAtMs: 1_763_700_006_000,
    cwd: CWD,
    permissions: { network: { enabled: true } },
    reason: "fetch a package",
  },
};

/** An empty grant for this turn. */
export const PERMISSIONS_REFUSED: RpcReply = {
  id: 203,
  result: { permissions: {}, scope: "turn" },
};

/** Ork never handles a credential. */
export const AUTH_REFRESH: RpcRequest = {
  id: 204,
  method: "account/chatgptAuthTokens/refresh",
  params: { reason: "unauthorized", previousAccountId: null },
};

/** The legacy v1 approval; its refusal is `denied`. */
export const LEGACY_EXEC_APPROVAL: RpcRequest = {
  id: 205,
  method: "execCommandApproval",
  params: {
    conversationId: THREAD_ID,
    callId: "call-2",
    approvalId: null,
    command: ["rm", "-rf", "/"],
    cwd: CWD,
    parsedCmd: [],
    reason: null,
  },
};

export const LEGACY_DENIED: RpcReply = {
  id: 205,
  result: { decision: "denied" },
};

/** A refusal as an error; the code is guessed. */
export const refused = (id: number | string, message: string): RpcReply => ({
  id,
  error: { code: -32601, message },
});

// Usage, hooks, errors and the turn's end.

const breakdown = (input: number, cached: number, output: number) => ({
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  reasoningOutputTokens: 0,
  totalTokens: input + output,
  cacheWriteInputTokens: 0,
});

export const TOKEN_USAGE: RpcNotification = {
  method: "thread/tokenUsage/updated",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    tokenUsage: {
      total: breakdown(1200, 800, 300),
      last: breakdown(400, 300, 100),
      modelContextWindow: 272_000,
    },
  },
};

/** Ork's own hook ran (source `sessionFlags`: a `-c` key). */
export const HOOK_COMPLETED: RpcNotification = {
  method: "hook/completed",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    run: {
      id: "hook-run-1",
      eventName: "preToolUse",
      handlerType: "command",
      executionMode: "sync",
      scope: "turn",
      source: "sessionFlags",
      sourcePath: "/tmp/ork-hook/hook.mjs",
      displayOrder: 0,
      startedAt: 1_763_700_001,
      completedAt: 1_763_700_001,
      durationMs: 5,
      status: "completed",
      entries: [],
    },
  },
};

/** `hooks/list`'s reply with a user hook beside Ork's: the fence would refuse. */
export const HOOKS_LIST_WITH_USER_HOOK: RpcReply = {
  id: 6,
  result: {
    data: [
      {
        cwd: CWD,
        errors: [],
        warnings: [],
        hooks: [
          {
            key: "ork",
            eventName: "preToolUse",
            handlerType: "command",
            command: "node /tmp/ork-hook/hook.mjs",
            source: "sessionFlags",
            sourcePath: "/tmp/ork-hook/hook.mjs",
            enabled: true,
            isManaged: false,
            trustStatus: "untrusted",
            currentHash: "a1",
            displayOrder: 0,
            timeoutSec: 60,
          },
          {
            key: "mine",
            eventName: "preToolUse",
            handlerType: "command",
            command: "./mine.sh",
            source: "user",
            sourcePath: "/home/user/.codex/config.toml",
            enabled: true,
            isManaged: false,
            trustStatus: "trusted",
            currentHash: "b2",
            displayOrder: 1,
            timeoutSec: 60,
          },
        ],
      },
    ],
  },
};

/** A provider error Codex retries: a warning, not an end. */
export const ERROR_RETRYING: RpcNotification = {
  method: "error",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    willRetry: true,
    error: {
      message: "stream disconnected before completion",
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
    },
  },
};

export const ERROR_FINAL: RpcNotification = {
  method: "error",
  params: {
    threadId: THREAD_ID,
    turnId: TURN_ID,
    willRetry: false,
    error: {
      message: "You've hit your usage limit.",
      codexErrorInfo: "usageLimitExceeded",
    },
  },
};

export const TURN_COMPLETED: RpcNotification = {
  method: "turn/completed",
  params: { threadId: THREAD_ID, turn: turn("completed") },
};

export const TURN_INTERRUPTED: RpcNotification = {
  method: "turn/completed",
  params: { threadId: THREAD_ID, turn: turn("interrupted") },
};

export const TURN_FAILED: RpcNotification = {
  method: "turn/completed",
  params: {
    threadId: THREAD_ID,
    turn: turn("failed", {
      message: "You've hit your usage limit.",
      codexErrorInfo: "usageLimitExceeded",
      additionalDetails: null,
    }),
  },
};

/** A failure the provider classifier should not know. */
export const TURN_FAILED_OTHER: RpcNotification = {
  method: "turn/completed",
  params: {
    threadId: THREAD_ID,
    turn: turn("failed", { message: "sandbox setup failed", codexErrorInfo: "sandboxError" }),
  },
};

/** One frame as Codex writes it: a JSON line. */
export const line = (
  frame: RpcRequest | RpcNotification | RpcReply,
): string => `${JSON.stringify(frame)}\n`;

/** A whole first leg, in the order Codex answers a client that steers once. */
export const FIRST_LEG: readonly (RpcRequest | RpcNotification | RpcReply)[] = [
  INITIALIZE_REPLY,
  THREAD_START_REPLY,
  THREAD_STARTED,
  TURN_START_REPLY,
  TURN_STARTED,
  COMMAND_STARTED,
  COMMAND_APPROVAL,
  HOOK_COMPLETED,
  COMMAND_COMPLETED,
  TURN_STEER_REPLY,
  FILE_CHANGE_STARTED,
  FILE_CHANGE_APPROVAL,
  FILE_CHANGE_COMPLETED,
  REPORT_COMPLETED,
  AGENT_MESSAGE_COMPLETED,
  TOKEN_USAGE,
  TURN_COMPLETED,
];
