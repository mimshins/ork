/**
 * @file The provider-error classifier, on error bodies in the shapes the
 *   providers send them (Anthropic's `{"type":"error","error":{…}}`, the
 *   OpenAI-style `{"error":{"code",…}}`, Claude Code's `API Error: <status>`
 *   lines and OpenCode's `commandcode` provider, including gaps L240's two
 *   refusals): type first, status next, words last.
 */

import { describe, expect, it } from "vitest";

import { classifyProviderError } from "../src/index.ts";

const anthropic = (type: string, message: string): string =>
  JSON.stringify({ type: "error", error: { type, message } });

const openai = (code: string, message: string, type = code): string =>
  JSON.stringify({ error: { message, type, param: null, code } });

/** Each fixture: the error text, its HTTP status when known, the kind. */
const FIXTURES: readonly (readonly [string, number | undefined, string])[] = [
  // Anthropic.
  [
    anthropic(
      "rate_limit_error",
      "Number of request tokens has exceeded your per-minute rate limit",
    ),
    429,
    "rate_limited",
  ],
  [anthropic("overloaded_error", "Overloaded"), 529, "provider_unavailable"],
  [
    anthropic("api_error", "Internal server error"),
    500,
    "provider_unavailable",
  ],
  [anthropic("authentication_error", "invalid x-api-key"), 401, "auth"],
  [
    anthropic(
      "permission_error",
      "Your API key does not have permission to use the specified resource.",
    ),
    403,
    "auth",
  ],
  [
    anthropic("not_found_error", "model: claude-nope"),
    404,
    "model_unavailable",
  ],
  [
    anthropic(
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    ),
    400,
    "out_of_credits",
  ],
  [
    anthropic(
      "invalid_request_error",
      "prompt is too long: 214023 tokens > 200000 maximum",
    ),
    400,
    "context_too_long",
  ],
  [
    anthropic(
      "request_too_large",
      "Request exceeds the maximum allowed number of bytes.",
    ),
    413,
    "context_too_long",
  ],
  // L240, through OpenCode's `commandcode` provider.
  [
    anthropic(
      "invalid_request_error",
      "This model does not support assistant message prefill. The conversation must end with a user message.",
    ),
    400,
    "model_unavailable",
  ],
  [
    anthropic(
      "invalid_request_error",
      "messages.1.content.0: Invalid `signature` in `thinking` block",
    ),
    400,
    "model_unavailable",
  ],
  // Claude Code's result text, no status passed.
  [
    `API Error: 529 ${anthropic("overloaded_error", "Overloaded")}`,
    undefined,
    "provider_unavailable",
  ],
  ["API Error: 500 Internal Server Error", undefined, "provider_unavailable"],
  ["Invalid API key · Please run /login", undefined, "auth"],
  ["Credit balance is too low", undefined, "out_of_credits"],
  ["Claude AI usage limit reached|1767225600", undefined, "plan_limit"],
  [
    "API Error: Connection error. (fetch failed)",
    undefined,
    "provider_unavailable",
  ],
  // OpenAI-style.
  [
    openai(
      "insufficient_quota",
      "You exceeded your current quota, please check your plan and billing details.",
    ),
    429,
    "out_of_credits",
  ],
  [
    openai("rate_limit_exceeded", "Rate limit reached for gpt-x", "requests"),
    429,
    "rate_limited",
  ],
  [
    openai(
      "invalid_api_key",
      "Incorrect API key provided.",
      "invalid_request_error",
    ),
    401,
    "auth",
  ],
  [
    openai(
      "context_length_exceeded",
      "This model's maximum context length is 128000 tokens.",
      "invalid_request_error",
    ),
    400,
    "context_too_long",
  ],
  [
    openai(
      "model_not_found",
      "The model `gpt-nope` does not exist or you do not have access to it.",
      "invalid_request_error",
    ),
    404,
    "model_unavailable",
  ],
  // OpenCode's own errors.
  ["ProviderAuthError\nInvalid API key", undefined, "auth"],
  ["MessageAbortedError\nAborted", undefined, "interrupted"],
  // A status alone, and a bare refusal.
  ["Service Unavailable", 503, "provider_unavailable"],
  ["Payment Required", 402, "out_of_credits"],
  ["Bad Request", 400, "model_unavailable"],
];

describe("classifyProviderError", () => {
  it.each(FIXTURES)("reads %s (status %s) as %s", (text, status, kind) => {
    expect(classifyProviderError(text, status)?.kind).toBe(kind);
  });

  it("gives Ork's sentence, never the provider's", () => {
    const said = anthropic("overloaded_error", "Overloaded");
    expect(classifyProviderError(said, 529)).toEqual({
      kind: "provider_unavailable",
      message: "could not reach its provider, or the provider was overloaded",
    });
  });

  it("decides by the error's type before its status", () => {
    const quota = openai("insufficient_quota", "quota");
    expect(classifyProviderError(quota, 429)?.kind).toBe("out_of_credits");
  });

  it("recognizes nothing in text it doesn't know", () => {
    expect(classifyProviderError("something odd happened")).toBeNull();
    expect(classifyProviderError("")).toBeNull();
  });
});
