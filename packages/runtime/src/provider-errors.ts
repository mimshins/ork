/**
 * @file The provider-error classifier every driver's adapter uses (specs/
 *   runtime/session-ends.md): an error a model provider sent back (Anthropic,
 *   OpenAI-style, or a proxy such as OpenCode's `commandcode`) to one end kind.
 *   It reads the error's type or code first, its HTTP status next, and its
 *   words last, so a changed sentence rarely changes the kind.
 */

import { END_KINDS, type EndKind } from "@krapht/ork-core";

/** What the classifier makes of an error: a kind and Ork's sentence for it. */
export type ProviderErrorClass = { kind: EndKind; message: string };

/** Error types and codes the providers document, by the kind they mean. */
const TYPES: Readonly<Record<string, EndKind>> = {
  // Anthropic's `error.type`.
  rate_limit_error: "rate_limited",
  overloaded_error: "provider_unavailable",
  api_error: "provider_unavailable",
  timeout_error: "provider_unavailable",
  authentication_error: "auth",
  permission_error: "auth",
  billing_error: "out_of_credits",
  not_found_error: "model_unavailable",
  request_too_large: "context_too_long",
  // OpenAI-style `error.code` / `error.type`.
  insufficient_quota: "out_of_credits",
  invalid_api_key: "auth",
  context_length_exceeded: "context_too_long",
  model_not_found: "model_unavailable",
  rate_limit_exceeded: "rate_limited",
  server_error: "provider_unavailable",
  // OpenCode's error names.
  ProviderAuthError: "auth",
  MessageAbortedError: "interrupted",
};

const TYPE = new RegExp(`\\b(${Object.keys(TYPES).join("|")})\\b`, "u");

/** HTTP statuses that decide by themselves; 400 needs the words. */
const statusKind = (status: number): EndKind | null => {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "out_of_credits";
  if (status === 404) return "model_unavailable";
  if (status === 413) return "context_too_long";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 529 || (status >= 500 && status < 600)) {
    return "provider_unavailable";
  }
  return null;
};

/** The words, when neither type nor status decided; the first match wins. */
const WORDS: readonly (readonly [EndKind, RegExp])[] = [
  [
    "plan_limit",
    /\busage limit reached\b|\bhit your (?:usage )?limit\b|\blimit will reset\b/iu,
  ],
  [
    "context_too_long",
    /\bprompt is too long\b|\bcontext (?:length|window)\b|\bmaximum context\b|\btoo many tokens\b/iu,
  ],
  [
    "out_of_credits",
    /\bcredit balance\b|\binsufficient (?:credits?|funds|balance|quota)\b|\bout of credits?\b|\bexceeded your current quota\b/iu,
  ],
  ["rate_limited", /\brate.?limit(?:ed)?\b|\btoo many requests\b/iu],
  [
    "auth",
    /\binvalid (?:x-)?api.?key\b|\bnot (?:logged|signed) in\b|\bplease run \/login\b|\bunauthori[sz]ed\b|\bOAuth token has expired\b/iu,
  ],
  [
    "provider_unavailable",
    /\boverloaded\b|\bservice unavailable\b|\bbad gateway\b|\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bfetch failed\b|\bsocket hang up\b|\bnetwork error\b/iu,
  ],
  [
    "model_unavailable",
    /\bassistant message prefill\b|\bInvalid `signature` in `thinking` block\b|\bmodel(?: \S+)? (?:not found|does not exist|is not supported)\b|\bdoes not support\b|\bunknown model\b/iu,
  ],
];

/** Generic refusals: the provider would not serve the request as it was. */
const REFUSED = /\binvalid_request_error\b|\binvalid_request\b/u;

/** A status written in the text, e.g. Claude Code's `API Error: 529 {…}`. */
const STATUS_IN_TEXT =
  /\bAPI Error:? (\d{3})\b|"(?:status|statusCode)"\s*:\s*(\d{3})\b|\b(?:status|HTTP)[ :]+(\d{3})\b/u;

const statusIn = (text: string): number | undefined => {
  const found = STATUS_IN_TEXT.exec(text);
  const digits = found?.[1] ?? found?.[2] ?? found?.[3];
  return digits === undefined ? undefined : Number(digits);
};

const classed = (kind: EndKind): ProviderErrorClass => ({
  kind,
  message: END_KINDS[kind].message({}),
});

/**
 * The end kind a provider's error means, with Ork's sentence for it; `null`
 * when nothing in it is recognized. `status` is the HTTP status when the caller
 * has it; otherwise one written in the text is read.
 */
export const classifyProviderError = (
  text: string,
  status?: number,
): ProviderErrorClass | null => {
  const type = TYPE.exec(text)?.[1];
  if (type !== undefined) return classed(TYPES[type] ?? "unknown");
  const code = status ?? statusIn(text);
  const byStatus = code === undefined ? null : statusKind(code);
  if (byStatus !== null) return classed(byStatus);
  const byWords = WORDS.find(([, pattern]) => pattern.test(text))?.[0];
  if (byWords !== undefined) return classed(byWords);
  return REFUSED.test(text) || code === 400
    ? classed("model_unavailable")
    : null;
};
