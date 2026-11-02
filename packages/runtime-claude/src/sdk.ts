/**
 * @file The SDK driver: runs a session in-process with the Claude Agent SDK,
 *   only with an API key or a cloud provider, never a claude.ai login. A node
 *   that can be paused gets a `PreToolUse` callback hook: a short pause holds
 *   the call, a long one defers it and resumes the session when the node
 *   continues (ADR-041).
 */

import {
  createSdkMcpServer,
  type HookCallbackMatcher,
  type Options,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeRuntime,
  HoldPort,
  RuntimeEvent,
  Session,
  SessionPorts,
  SessionSpec,
  SessionUsage,
} from "@krapht/ork-core";

import {
  addUsage,
  HOOK_TIMEOUT_S,
  holdAtTool,
  type Leg,
  legStep,
} from "./hold.ts";
import { driverFailure } from "./normalize.ts";
import { createQueue } from "./queue.ts";
import { orkTools, preapprovedTools } from "./tools/registry.ts";
import { ORK_SERVER } from "./tools/tool.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The SDK driver runs only with an API key or a cloud provider. It must never
 * fall back to a claude.ai login: Anthropic does not allow third-party tools to
 * route requests through subscription credentials.
 */
export const sdkCredentials = (env: Env): string | null => {
  if (env["CLAUDE_CODE_USE_BEDROCK"] === "1") return "Amazon Bedrock";
  if (env["CLAUDE_CODE_USE_VERTEX"] === "1") return "Google Vertex AI";
  if (env["CLAUDE_CODE_USE_FOUNDRY"] === "1") return "Microsoft Foundry";
  if ((env["ANTHROPIC_API_KEY"] ?? "") !== "") return "ANTHROPIC_API_KEY";
  return null;
};

export const NO_SDK_CREDENTIALS =
  "the sdk driver needs ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1); use --driver cli to run with your own claude login";

/** A later message goes in at the next step, even mid-turn. */
const userMessage = (text: string, later = false): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  ...(later ? { priority: "next" } : {}),
});

const definedEnv = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/**
 * The hold hook: waits before each tool call while the node is paused, and
 * defers the call (`onDefer`) when the pause outlasts the window.
 */
const holdHook = (
  hold: HoldPort,
  onDefer: () => void,
  windowMs?: number,
): HookCallbackMatcher => ({
  timeout: HOOK_TIMEOUT_S,
  hooks: [
    async (_input, _toolUseId, { signal }) => {
      if ((await holdAtTool(hold, signal, windowMs)) === "go") return {};
      onDefer();
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "defer",
          permissionDecisionReason:
            "Ork paused this node; it goes on from this call when it continues.",
        },
      };
    },
  ],
});

/** The Agent SDK options for a session spec. */
export const buildSdkOptions = (
  spec: SessionSpec,
  ports: SessionPorts,
  env: Env,
  held?: { onDefer: () => void; windowMs?: number },
): Options => {
  const { human } = ports;
  const tools = orkTools({ nodeId: spec.nodeId, driver: "sdk", ports });
  const ork = createSdkMcpServer({
    name: ORK_SERVER,
    version: "0.0.0",
    tools: tools.map(t =>
      tool(t.name, t.description, t.shape, args => t.call(args)),
    ),
  });
  const options: Options = {
    cwd: spec.cwd,
    env: definedEnv(env),
    settingSources: spec.settingSources,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: spec.systemAppend,
    },
    permissionMode: spec.permissionMode,
    allowedTools: [...spec.tools.allow, ...preapprovedTools(tools)],
    disallowedTools: spec.tools.deny,
    mcpServers: { [ORK_SERVER]: ork },
    outputFormat: { type: "json_schema", schema: spec.reportSchema },
    canUseTool: async (toolName, input) => {
      const decision = await human.permit({
        nodeId: spec.nodeId,
        toolName,
        input,
      });
      return decision.allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: decision.message };
    },
  };
  if (spec.tools.only !== undefined) options.tools = spec.tools.only;
  if (spec.agents !== undefined) options.agents = spec.agents;
  if (spec.model !== undefined) options.model = spec.model;
  if (spec.effort !== undefined) options.effort = spec.effort;
  if (spec.maxTurns !== undefined) options.maxTurns = spec.maxTurns;
  if (spec.budgetUsd !== undefined) options.maxBudgetUsd = spec.budgetUsd;
  if (spec.resume !== undefined) options.resume = spec.resume;
  if (spec.plugins !== undefined) {
    options.plugins = spec.plugins.map(dir => ({ type: "local", path: dir }));
  }
  if (spec.settings !== undefined) options.settings = spec.settings;
  if (ports.hold !== undefined && held !== undefined) {
    options.hooks = {
      PreToolUse: [holdHook(ports.hold, held.onDefer, held.windowMs)],
    };
  }
  return options;
};

/** Drives a session with the Claude Agent SDK, in this process. */
export const createSdkRuntime = (
  env: Env = process.env,
  holdWindowMs?: number,
): ClaudeRuntime => ({
  driver: "sdk",
  start: (spec, ports): Session => {
    let input = createQueue<SDKUserMessage>();
    input.push(userMessage(spec.prompt));
    let current: ReturnType<typeof query> | undefined;
    const ended = new AbortController();
    /** The hold hook deferred a call in the current query. */
    let deferring = false;
    const held = {
      onDefer: () => {
        deferring = true;
      },
      ...(holdWindowMs === undefined ? {} : { windowMs: holdWindowMs }),
    };

    /** One query: a leg of the session, until its result. */
    const leg = async function* (
      resume: string | undefined,
      carried: SessionUsage | undefined,
    ): AsyncGenerator<RuntimeEvent, Leg> {
      deferring = false;
      const legSpec = resume === undefined ? spec : { ...spec, resume };
      current = query({
        prompt: input,
        options: buildSdkOptions(legSpec, ports, env, held),
      });
      let outcome: Leg = { kind: "failed", reason: "the session ended early" };
      for await (const message of current) {
        const { events, ended: end } = legStep(message, {
          carried,
          deferred: deferring,
          driver: "sdk",
        });
        yield* events;
        // The first result ends the query; a later one resumes the session.
        if (end !== undefined) {
          input.close();
          outcome = end;
        }
      }
      return outcome;
    };

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      if (sdkCredentials(env) === null) {
        yield driverFailure(NO_SDK_CREDENTIALS);
        return;
      }
      let resume = spec.resume;
      let spent: SessionUsage | undefined;
      try {
        for (;;) {
          const result = yield* leg(resume, spent);
          if (result.kind === "failed") {
            yield driverFailure(result.reason);
            return;
          }
          if (result.kind === "finished") return;
          // Deferred: messages sent meanwhile go to the next query, which
          // resumes the session once the node continues.
          input = createQueue<SDKUserMessage>();
          spent =
            spent === undefined ? result.usage : addUsage(spent, result.usage);
          // oxlint-disable-next-line eslint/no-await-in-loop -- one leg at a time
          await ports.hold?.wait("tool", ended.signal);
          if (ended.signal.aborted) {
            yield result.last;
            return;
          }
          resume = result.sessionId;
        }
      } catch (error) {
        input.close();
        yield driverFailure(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    return {
      events: events(),
      send: text => {
        input.push(userMessage(text, true));
      },
      interrupt: async () => {
        ended.abort();
        await current?.interrupt();
      },
    };
  },
});
