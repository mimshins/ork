/**
 * @file `ork context explain <wf> <node>`: what one node's session would load,
 *   layer by layer, as core's `explainSession` plans it without writing
 *   anything: its project instructions, every skill with the layer it came from
 *   and whether it is live, shadowed or switched off, its context files, its
 *   practices, and estimated tokens.
 */

import {
  estimateTokens,
  type Explanation,
  explainSession,
  LESSON_CAP_TOKENS,
} from "@krapht/ork-core";
import { defineCommand } from "citty";

import { style, write } from "../output.ts";
import { refusedBuiltin, workflowArg } from "../workflows.ts";
import { formatReport, loadWorkflow } from "./validate.ts";

/** A rough count, for comparing sizes: about four characters a token. */
export const tokens = estimateTokens;

export type ExplainResult =
  | { ok: true; explanation: Explanation }
  | { ok: false; lines: string[] };

/** Loads a workflow file and plans one node's session in it, in place. */
export const explainNode = (
  file: string,
  nodeId: string,
  cwd: string,
  home?: string,
): ExplainResult => {
  const { report, workflow, graph, place, workflowDir } = loadWorkflow(
    file,
    cwd,
    home,
  );
  if (workflow === null) return { ok: false, lines: formatReport(report) };
  const result = explainSession(workflow, graph, nodeId, {
    root: place.root,
    orkDir: place.dir,
    workflowDir,
    ...(home === undefined ? {} : { home }),
  });
  return result.ok ? result : { ok: false, lines: [result.error] };
};

const approx = (count: number): string =>
  style("dim", `≈${count.toLocaleString("en")} tokens`);

export const formatExplanation = (e: Explanation): string[] => {
  const width = Math.max(8, ...e.skills.map(s => s.name.length));
  const sourceWidth = Math.max(0, ...e.skills.map(s => s.source.length));
  const lines = [
    `${style("bold", e.node)} ${style("dim", `(${e.type}) in ${e.workflow}`)}${e.template === undefined ? "" : style("dim", `, planned as ${e.template}, the node it was spawned from`)}`,
    "",
    ...(e.agent === undefined
      ? []
      : [
          `${style("bold", "Agent")}  ${e.agent.name} ${style("dim", `(${e.agent.where})`)}  ${approx(e.agent.tokens)}`,
        ]),
    `${style("bold", "Instructions")}  ${e.instructions}`,
    "",
    style("bold", "Skills"),
  ];
  if (e.skills.length === 0) lines.push(style("dim", "  none"));
  for (const s of e.skills) {
    const mark = s.state === "live" ? style("green", "✓") : style("dim", "−");
    const state =
      s.why === undefined
        ? approx(s.tokens).replace("tokens", "tokens when used")
        : style("yellow", `off: ${s.why}`);
    lines.push(
      `  ${mark} ${s.name.padEnd(width)}  ${s.layer.padEnd(8)}  ${style("dim", s.source.padEnd(sourceWidth))}  ${state}`,
    );
  }
  lines.push("", style("bold", "Context files"));
  if (e.files.length === 0) lines.push(style("dim", "  none"));
  for (const f of e.files) {
    const cut =
      f.cutFrom === undefined
        ? ""
        : `  ${style("yellow", `cut at the ${LESSON_CAP_TOKENS.toLocaleString("en")}-token cap; the whole file is ${approx(f.cutFrom)}`)}`;
    lines.push(`  ${f.layer.padEnd(8)}  ${f.name}  ${approx(f.tokens)}${cut}`);
  }
  lines.push("", style("bold", "Practices"));
  for (const p of e.practices)
    lines.push(`  ${p.name.padEnd(8)}  ${approx(p.tokens)}`);
  for (const name of e.skippedPractices) {
    lines.push(
      `  ${name.padEnd(8)}  ${style("dim", "the project's own skill wins")}`,
    );
  }
  if (e.practices.length === 0 && e.skippedPractices.length === 0) {
    lines.push(style("dim", "  off"));
  }
  lines.push(
    "",
    `Appended to Claude Code's system prompt: ${approx(e.appendedTokens)}`,
  );
  return lines;
};

const explain = defineCommand({
  meta: {
    name: "explain",
    description: "Show what one node's session loads, layer by layer",
  },
  args: {
    workflow: {
      type: "positional",
      description:
        "A workflow file, the name of one in the project's workflows (.ork/workflows/), or one of Ork's own (ork:feedback-apply)",
      required: true,
    },
    node: { type: "positional", description: "Node id", required: true },
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run: ({ args }) => {
    const cwd = process.cwd();
    if (refusedBuiltin([args.workflow])) return;
    const result = explainNode(
      workflowArg(args.workflow, cwd).file,
      args.node,
      cwd,
    );
    if (!result.ok) {
      for (const line of result.lines) process.stderr.write(`${line}\n`);
      process.exitCode = 1;
      return;
    }
    if (args.json) write(JSON.stringify(result.explanation, undefined, 2));
    else for (const line of formatExplanation(result.explanation)) write(line);
  },
});

export const context = defineCommand({
  meta: {
    name: "context",
    description: "Inspect the context Ork compiles for each node",
  },
  subCommands: { explain },
});
