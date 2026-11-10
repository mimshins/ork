/**
 * @file Reads Claude Code's own transcripts of a repository, for the control
 *   estimate (control.ts): each session's messages priced per token and scaled
 *   to its `cost-state` record (what Claude Code itself reported), its working
 *   spans (a human prompt to the last event before the next one), and the
 *   pushes to main its tool results show.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { count, type Json, parse, rec, records, text } from "./json.ts";

/** Per million tokens: input, output, cache read, 5-minute and 1-hour write. */
type Rates = readonly [number, number, number, number, number];

/**
 * Fitted to Claude Code's `cost-state` records to the cent for Opus and Sonnet.
 * Each session's messages are scaled to its record afterwards, so a rate off
 * here moves only how cost spreads across the session's windows.
 */
export const RATES: Readonly<Record<string, Rates>> = {
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5, 4],
  "claude-haiku-5-5": [1, 5, 0.1, 1.25, 2],
};
const DEFAULT_RATES: Rates = [2, 10, 0.1, 2.5, 4];

/** One message's price, from its `usage` block. */
export const priceOf = (model: string, usage: Json): number => {
  const r = RATES[model] ?? DEFAULT_RATES;
  const split = rec(usage["cache_creation"]);
  const w5 = count(split["ephemeral_5m_input_tokens"]);
  const w1 =
    typeof split["ephemeral_1h_input_tokens"] === "number"
      ? split["ephemeral_1h_input_tokens"]
      : count(usage["cache_creation_input_tokens"]) - w5;
  return (
    (count(usage["input_tokens"]) * r[0] +
      count(usage["output_tokens"]) * r[1] +
      count(usage["cache_read_input_tokens"]) * r[2] +
      w5 * r[3] +
      w1 * r[4]) /
    1e6
  );
};

/** A prompt the person typed: not a tool result, not text Claude Code added. */
export const isHumanPrompt = (e: Json): boolean => {
  if (e["type"] !== "user" || e["isMeta"] === true || e["isSidechain"] === true)
    return false;
  const content = rec(e["message"])["content"];
  const typed = text(content);
  if (typed !== undefined) return !typed.startsWith("<");
  const parts = records(content);
  return (
    !parts.some(c => c["type"] === "tool_result") &&
    parts.some(
      c => c["type"] === "text" && !(text(c["text"]) ?? "<").startsWith("<"),
    )
  );
};

/** The pushes to main a text shows, as `from..to` ranges. */
export const pushesIn = (shown: string): { from: string; to: string }[] =>
  [
    ...shown.matchAll(/([0-9a-f]{7,40})\.\.([0-9a-f]{7,40}) +main -> main/gu),
  ].map(m => ({ from: m[1] ?? "", to: m[2] ?? "" }));

export type Session = {
  id: string;
  messages: { at: number; model: string; usd: number }[];
  spans: { start: number; end: number }[];
  pushes: { at: number; from: string; to: string }[];
};

const readJsonl = (file: string): Json[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .map(line => parse(line))
    .filter(e => e !== undefined)
    .map(e => rec(e));

/** Each message once (it is logged once per content block), priced. */
const pricedMessages = (entries: readonly Json[]): Session["messages"] => {
  const seen = new Set<string>();
  const messages: Session["messages"] = [];
  for (const e of entries) {
    const m = rec(e["message"]);
    const model = text(m["model"]);
    const key = text(m["id"]) ?? text(e["requestId"]) ?? text(e["uuid"]) ?? "";
    if (e["type"] !== "assistant" || model === undefined) continue;
    if (model === "<synthetic>" || m["usage"] === undefined || seen.has(key))
      continue;
    seen.add(key);
    const at = Date.parse(text(e["timestamp"]) ?? "");
    messages.push({ at, model, usd: priceOf(model, rec(m["usage"])) });
  }
  return messages;
};

/** From each human prompt to the last event before the next one. */
const workingSpans = (entries: readonly Json[]): Session["spans"] => {
  const times = entries
    .filter(e => typeof e["timestamp"] === "string")
    .map(e => ({
      at: Date.parse(text(e["timestamp"]) ?? ""),
      human: isHumanPrompt(e),
    }))
    .toSorted((a, b) => a.at - b.at);
  const spans: Session["spans"] = [];
  for (const t of times) {
    const current = spans.at(-1);
    if (t.human) spans.push({ start: t.at, end: t.at });
    else if (current !== undefined) current.end = t.at;
  }
  return spans;
};

/** One session's transcript and its subagents', or null without a cost record. */
const readSession = (dir: string, file: string): Session | null => {
  const id = file.replace(/\.jsonl$/u, "");
  const main = readJsonl(path.join(dir, file));
  const cost = main.findLast(e => e["type"] === "cost-state");
  if (cost === undefined) return null;
  const subDir = path.join(dir, id, "subagents");
  const subs = existsSync(subDir)
    ? readdirSync(subDir)
        .filter(f => f.endsWith(".jsonl"))
        .flatMap(f => readJsonl(path.join(subDir, f)))
    : [];
  const messages = pricedMessages([...main, ...subs]);
  for (const [model, u] of Object.entries(rec(cost["modelUsage"]))) {
    const mine = messages.filter(m => m.model === model);
    const priced = mine.reduce((s, m) => s + m.usd, 0);
    const reported = count(rec(u)["costUSD"]);
    if (priced > 0) for (const m of mine) m.usd *= reported / priced;
  }
  const pushes = main.flatMap(e => {
    const shown = JSON.stringify(
      rec(e["message"])["content"] ?? e["toolUseResult"] ?? "",
    );
    const at = Date.parse(text(e["timestamp"]) ?? "");
    return pushesIn(shown).map(p => Object.assign({ at }, p));
  });
  return { id, messages, spans: workingSpans(main), pushes };
};

/** Every session in a transcripts folder that has a cost record. */
export const readSessions = (dir: string): Session[] =>
  readdirSync(dir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => readSession(dir, f))
    .filter(s => s !== null);

/** Claude Code's transcripts folder for a repository. */
export const transcriptsOf = (home: string, repo: string): string =>
  path.join(
    home,
    ".claude",
    "projects",
    path.resolve(repo).replaceAll(/[^A-Za-z0-9]/gu, "-"),
  );
