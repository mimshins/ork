/**
 * @file The Context panel's tests' data: a node's explanation as the server
 *   answers it, with a live skill and one a higher layer shadows, a context
 *   file, the instruction file, a practice on and one off, and the appended
 *   prompt; and the fake server's answers to the context routes.
 */

import type { Explanation, NodeContextAnswer } from "@krapht/ork-server/client";

export const EXPLANATION: Explanation = {
  node: "fix",
  type: "agent.worker",
  workflow: "review",
  agent: {
    name: "reviewer",
    where: ".ork/agents/reviewer.md",
    source: "project",
    tokens: 12,
    text: "Review with care.\n",
  },
  instructions: "AGENTS.md, loaded by Claude Code",
  instructionFiles: [{ name: "AGENTS.md", tokens: 3, text: "# Agents\n" }],
  skills: [
    {
      name: "review",
      layer: "project",
      source: ".claude/skills/review",
      state: "off",
      why: "shadowed by the workflow layer",
      tokens: 9,
      text: "---\nname: review\n---\nproject\n",
    },
    {
      name: "ork:review",
      layer: "workflow",
      source: ".ork/workflows/skills/review",
      state: "live",
      tokens: 1204,
      text: "---\nname: review\n---\nours\n",
    },
  ],
  files: [
    {
      layer: "workflow",
      name: ".ork/workflows/style.md",
      tokens: 3,
      text: "Be brief.\n",
    },
  ],
  practices: [{ name: "caveman", tokens: 310, text: "Talk less.\n" }],
  skippedPractices: ["ponytail"],
  appendedTokens: 3120,
  appended: "Talk less.\n\nBe brief.\n",
};

export const planned = (
  explanation: Partial<Explanation> = {},
  changedSinceStart: string[] = [],
): NodeContextAnswer => ({
  planned: true,
  explanation: { ...EXPLANATION, ...explanation },
  changedSinceStart,
});

const RUN_CONTEXT = /^\/api\/runs\/([^/]+)\/nodes\/([^/]+)\/context$/u;
const BUILDER_CONTEXT =
  /^\/api\/projects\/([^/]+)\/builder\/([^/]+)\/nodes\/([^/]+)\/context$/u;

export type ContextAsk = { kind: "run" | "builder"; node: string };

/**
 * The fake server's context routes: `answer` says what to answer each ask, a
 * string being a refusal; every ask is recorded.
 */
export const contextRoutes = (
  answer: (ask: ContextAsk) => NodeContextAnswer | string,
) => {
  const asked: ContextAsk[] = [];
  const route = (path: string): Response | undefined => {
    const run = RUN_CONTEXT.exec(path);
    const builder = BUILDER_CONTEXT.exec(path);
    const node = decodeURIComponent(run?.[2] ?? builder?.[3] ?? "");
    if (run === null && builder === null) return undefined;
    const ask: ContextAsk = { kind: run === null ? "builder" : "run", node };
    asked.push(ask);
    const reply = answer(ask);
    return typeof reply === "string"
      ? new Response(JSON.stringify({ error: reply }), { status: 404 })
      : new Response(JSON.stringify(reply), { status: 200 });
  };
  return { asked, route };
};
