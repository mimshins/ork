/**
 * @file The most `ork onboard`'s paid part can spend: the sum of both built-in
 *   workflows' own `limits`, read from their text, in dollars and in tokens
 *   (specs/cli/onboard-flow.md#the-cost-preview). Tokens are what holds a run
 *   on a driver that reports no dollars.
 */

import { builtinWorkflowText } from "@krapht/ork-core";
import { parseWorkflow } from "@krapht/ork-schema";

export const PROPOSE = "ork:onboard-propose";
export const WRITE = "ork:onboard-write";

export type Cap = { usd: number; tokens: number };

export type Caps = { propose: Cap; write: Cap; usd: number; tokens: number };

/** One built-in's `limits`; throws when it sets neither, which a test pins. */
const capOf = (name: string): Cap => {
  const text = builtinWorkflowText(name);
  const parsed = text === undefined ? undefined : parseWorkflow(text);
  const limits = parsed?.ok === true ? parsed.workflow.limits : undefined;
  if (limits?.budgetUsd === undefined || limits.budgetTokens === undefined) {
    throw new Error(`${name} sets no budgetUsd and budgetTokens limit.`);
  }
  return { usd: limits.budgetUsd, tokens: limits.budgetTokens };
};

export const capsOfOnboard = (): Caps => {
  const propose = capOf(PROPOSE);
  const write = capOf(WRITE);
  return {
    propose,
    write,
    usd: propose.usd + write.usd,
    tokens: propose.tokens + write.tokens,
  };
};

const usd = (n: number): string => `$${String(n)}`;
const count = (n: number): string => n.toLocaleString("en-US");

/** The preview's line, as the spec words it. */
export const previewLine = (caps: Caps): string =>
  `The most this can spend: ${usd(caps.usd)} or ${count(caps.tokens)} tokens (propose ${usd(caps.propose.usd)}, ${count(caps.propose.tokens)} tokens; write ${usd(caps.write.usd)}, ${count(caps.write.tokens)} tokens).`;
