import {
  createSdkMcpServer,
  type Options,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeRuntime,
  HumanChannel,
  RuntimeEvent,
  Session,
  SessionSpec,
} from "@ork/core";

import { driverFailure, normalize } from "./normalize.ts";
import { createQueue } from "./queue.ts";
import {
  ASK_USER_DESCRIPTION,
  askUser,
  askUserShape,
  ORK_SERVER,
} from "./tools.ts";

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

const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});

const definedEnv = (env: Env): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** The Agent SDK options for a session spec. */
export const buildSdkOptions = (
  spec: SessionSpec,
  human: HumanChannel,
  env: Env,
): Options => {
  const ork = createSdkMcpServer({
    name: ORK_SERVER,
    version: "0.0.0",
    tools: [
      tool(
        "ask_user",
        ASK_USER_DESCRIPTION,
        askUserShape,
        askUser(human, spec.nodeId),
      ),
    ],
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
    allowedTools: [...spec.tools.allow, `mcp__${ORK_SERVER}__ask_user`],
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
  if (spec.model !== undefined) options.model = spec.model;
  if (spec.maxTurns !== undefined) options.maxTurns = spec.maxTurns;
  if (spec.budgetUsd !== undefined) options.maxBudgetUsd = spec.budgetUsd;
  if (spec.resume !== undefined) options.resume = spec.resume;
  return options;
};

/** Drives a session with the Claude Agent SDK, in this process. */
export const createSdkRuntime = (env: Env = process.env): ClaudeRuntime => ({
  driver: "sdk",
  start: (spec, human): Session => {
    const input = createQueue<SDKUserMessage>();
    input.push(userMessage(spec.prompt));
    let current: ReturnType<typeof query> | undefined;

    const events = async function* (): AsyncGenerator<RuntimeEvent> {
      if (sdkCredentials(env) === null) {
        yield driverFailure(NO_SDK_CREDENTIALS);
        return;
      }
      try {
        current = query({
          prompt: input,
          options: buildSdkOptions(spec, human, env),
        });
        for await (const message of current) {
          for (const event of normalize(message)) {
            // The first result ends the session; later messages resume it.
            if (event.type === "session.finished") input.close();
            yield event;
          }
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
        input.push(userMessage(text));
      },
      interrupt: async () => {
        await current?.interrupt();
      },
    };
  },
});
