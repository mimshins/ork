/**
 * @file The tool node executor, for every registered integration (`tool.gh`,
 *   `tool.aws`, `tool.git`, `tool.shell`, …): the user's own program, run
 *   without a shell, checked against `allow` (or the integration's default),
 *   its arguments and observed output fields from the integration's adapter,
 *   long output kept in run files. It sees who it is and the node's `env:`
 *   (`tool-env.ts`), may return JSON (`tool-output.ts`), and may run once per
 *   set of files (`runUnlessPassed` in `tool-command.ts`).
 */

import path from "node:path";

import {
  declaredProblem,
  type ExecuteContext,
  type NodeExecutor,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import { integrationFor } from "@krapht/ork-integrations";
import { isToolNode, markValue, type ToolNode } from "@krapht/ork-schema";

import {
  commandLineOf,
  runUnlessPassed,
  tokenize,
  type ToolRun,
  type ToolRunner,
} from "./tool-command.ts";
import { exitEnd, failed, invalidOutput, skippedCheck } from "./tool-ends.ts";
import {
  identityOf,
  maskedEnv,
  namesToMask,
  OUTPUT_ENV,
  renderEnv,
  safeRunner,
  secretsOf,
  STATE_ENV,
  type ToolOptions,
} from "./tool-env.ts";
import {
  keepFile,
  prepareOutputFile,
  readJsonOutput,
  removeOutputFile,
  writeScriptFile,
} from "./tool-output.ts";
import { scrubberOf } from "./tool-scrub.ts";
import { prepareStateFile } from "./tool-state.ts";

/** How much of stdout and stderr a node's output keeps. */
export const OUTPUT_LIMIT = 64 * 1024;

const ERROR_LIMIT = 1024;

/** The interpreters whose script's commands a heavy check reads. */
const SHELLS = new Set(["sh", "bash", "zsh"]);

/** Whether `args` starts with one of the allowed prefixes (`"pr merge"`). */
export const isAllowed = (
  args: readonly string[],
  allow?: readonly string[],
): boolean =>
  allow === undefined ||
  allow.some(prefix => {
    const words = prefix.trim().split(/\s+/u);
    return words.every((word, i) => args[i] === word);
  });

const render = (
  text: string,
  context: ExecuteContext,
): { ok: true; value: string } | { ok: false; error: string } => {
  const template = parseTemplate(text);
  if (!template.ok) return { ok: false, error: template.message };
  return {
    ok: true,
    value: renderTemplate(
      template.parts,
      runScope(context.inputs, context.outputs, context.runId, context.item),
    ),
  };
};

/** The program and arguments a tool node runs, before the allow check. */
export const commandOf = (
  node: ToolNode,
  context: ExecuteContext,
):
  | { ok: true; program: string; args: string[] }
  | { ok: false; error: string } => {
  const line = commandLineOf(node);
  if (line === undefined) {
    return { ok: false, error: "the node has no command or script" };
  }
  const tokens = tokenize(line);
  if (!tokens.ok) return tokens;
  const args: string[] = [];
  for (const token of tokens.args) {
    // What runs a script takes no templates, however it was written.
    if (node.script !== undefined) {
      args.push(token);
      continue;
    }
    const rendered = render(token, context);
    if (!rendered.ok) return rendered;
    args.push(rendered.value);
  }
  const integration = integrationFor(node.type);
  if (integration === undefined) {
    return { ok: false, error: `no integration for ${node.type}` };
  }
  const extra = integration.args(node);
  if (integration.program !== null) {
    return {
      ok: true,
      program: integration.program,
      args: [...args, ...extra],
    };
  }
  const [program, ...rest] = [...args, ...extra];
  if (program === undefined || program === "") {
    return { ok: false, error: "the command names no program" };
  }
  return { ok: true, program, args: rest };
};

/** Keeps the first `OUTPUT_LIMIT` characters; the rest goes to a file. */
export const capped = (text: string, file: () => string): string => {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n… (truncated; the full output is in ${file()})`;
};

/**
 * Text for a node's `error`, which reaches its events, its `notify:` rules and
 * what a session is told. All of it is kept in the output's fields and files.
 */
export const clipError = (text: string): string =>
  text.length <= ERROR_LIMIT ? text : `${text.slice(0, ERROR_LIMIT)}…`;

/** Runs a user's CLI through its integration's adapter, with its own login. */
export const toolExecutor =
  (given: ToolRunner, options: ToolOptions = {}): NodeExecutor =>
  async context => {
    const { node } = context;
    if (!isToolNode(node))
      return failed(`${context.id} is not a tool`, "unknown");
    const environ = options.environ ?? process.env;
    // A value can also arrive through an input, so this covers the command too.
    const scrub = scrubberOf(
      secretsOf(context.workflow, environ, options.maskedNames),
    );
    const command = commandOf(node, context);
    if (!command.ok) return failed(scrub(command.error));
    const integration = integrationFor(node.type);
    // A program-less integration (any program) checks the program too.
    const checked =
      integration?.program === null
        ? [command.program, ...command.args]
        : command.args;
    const allow = node.allow ?? integration?.allow;
    if (!isAllowed(checked, allow)) {
      return failed(
        scrub(
          `${markValue(checked.join(" "))} is not in the node's allow list (${(allow ?? []).map(entry => markValue(entry)).join(", ")})`,
        ),
      );
    }
    let cwd = context.cwd;
    if (node.cwd !== undefined) {
      const rendered = render(node.cwd, context);
      if (!rendered.ok) return failed(rendered.error);
      cwd = path.resolve(context.cwd, rendered.value);
    }
    const nodeEnv = renderEnv(node, context, environ);
    if (!nodeEnv.ok) return failed(nodeEnv.error);
    const runner = safeRunner(given, scrub);
    const outputFile =
      node.output?.format === "json"
        ? prepareOutputFile(context.runDir, context.id, context.round)
        : undefined;
    const env = {
      ...nodeEnv.values,
      ...identityOf(context, options.orkBin, environ, options.store),
      ...maskedEnv(namesToMask(context.workflow, environ, options.maskedNames)),
      ...(outputFile === undefined ? {} : { [OUTPUT_ENV]: outputFile }),
      ...(node.watch === undefined
        ? {}
        : { [STATE_ENV]: prepareStateFile(context.runDir, context.id) }),
    };
    const names = Object.keys(nodeEnv.values);
    const shown = scrub(
      [
        command.program,
        ...command.args,
        ...(node.script === undefined ? [] : ["<script>"]),
      ].join(" "),
    );
    const execute = async (): Promise<ToolRun> => {
      // A heavy command waits for a machine-wide slot first; its timeout waits too.
      const release = await context.machine?.slot(
        [command.program, ...command.args].join(" "),
        context.signal,
        node.script !== undefined && SHELLS.has(path.basename(command.program))
          ? { script: node.script }
          : {},
      );
      context.emit({
        type: "tool.called",
        id: context.id,
        name: scrub(command.program),
        input: {
          command: shown,
          ...(names.length === 0 ? {} : { env: names }),
        },
      });
      const scriptFile =
        node.script === undefined
          ? undefined
          : writeScriptFile(
              context.runDir,
              context.id,
              context.round,
              node.script,
            );
      const priority = context.machine?.priority;
      return runner(
        command.program,
        scriptFile === undefined ? command.args : [...command.args, scriptFile],
        {
          cwd,
          signal: context.signal,
          env,
          ...(priority === undefined ? {} : { priority }),
        },
      ).finally(() => {
        release?.();
        if (scriptFile !== undefined) removeOutputFile(scriptFile);
      });
    };
    const check = { node, context, cwd, shown, environ, execute };
    const raw = await runUnlessPassed(check);
    if (raw === null) return skippedCheck(outputFile);
    const run = {
      exitCode: raw.exitCode,
      stdout: scrub(raw.stdout),
      stderr: scrub(raw.stderr),
    };
    const observed =
      (await integration?.observe?.read(async args => {
        const seen = await runner(command.program, args, {
          cwd,
          signal: context.signal,
          env,
        });
        return { ok: seen.exitCode === 0, stdout: seen.stdout };
      })) ?? {};
    const keep = (field: string, text: string) =>
      keepFile(context, field, text);
    const output: Record<string, unknown> = {
      exitCode: run.exitCode,
      stdout: capped(run.stdout, keep("stdout", run.stdout)),
      stderr: capped(run.stderr, keep("stderr", run.stderr)),
    };
    for (const [field, text] of Object.entries(observed)) {
      output[field] = capped(scrub(text), keep(field, scrub(text)));
    }
    if (outputFile !== undefined && run.exitCode !== 0) {
      removeOutputFile(outputFile);
    }
    const json =
      outputFile === undefined || run.exitCode !== 0
        ? null
        : readJsonOutput({
            file: outputFile,
            stdout: raw.stdout,
            scrub,
            limit: OUTPUT_LIMIT,
            keep: text => keep("json", text)(),
          });
    const declared =
      json?.ok === true
        ? declaredProblem(node.output?.schema, json.json)
        : null;
    context.emit({
      type: "tool.result",
      id: context.id,
      isError: run.exitCode !== 0 || json?.ok === false || declared !== null,
      ...(raw.cpu === undefined ? {} : { cpu: raw.cpu }),
    });
    if (json?.ok === false) return invalidOutput(output, json.error);
    // What it didn't declare isn't its output, so no condition can read it.
    if (declared !== null) return invalidOutput(output, declared);
    if (json !== null) output["json"] = json.json;
    const signedOut = integration?.signedOut;
    return exitEnd(output, run, context, scrub(command.program), signedOut);
  };
