import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type ExecuteContext,
  type NodeExecutor,
  type NodeResult,
  parseTemplate,
  renderTemplate,
  runScope,
} from "@krapht/ork-core";
import type { Node } from "@krapht/ork-schema";

export type ToolRun = { exitCode: number; stdout: string; stderr: string };

/** Starts a program with arguments, never through a shell. */
export type ToolRunner = (
  program: string,
  args: readonly string[],
  options: { cwd: string; signal: AbortSignal },
) => Promise<ToolRun>;

type ToolNode = Extract<Node, { type: "tool.gh" | "tool.aws" | "tool.shell" }>;

/** How much of stdout and stderr a node's output keeps. */
export const OUTPUT_LIMIT = 64 * 1024;

/**
 * Splits a command into arguments the way a shell would, without running one:
 * whitespace separates, `'…'` is literal, `"…"` and `\` escape, and `{{ … }}`
 * stays whole so a template is rendered inside its own argument.
 */
export const tokenize = (
  command: string,
): { ok: true; args: string[] } | { ok: false; error: string } => {
  const args: string[] = [];
  let current: string | null = null;
  let index = 0;
  const add = (text: string) => {
    current = (current ?? "") + text;
  };
  while (index < command.length) {
    const char = command.charAt(index);
    if (command.startsWith("{{", index)) {
      const end = command.indexOf("}}", index + 2);
      if (end === -1) return { ok: false, error: "unclosed {{ in command" };
      add(command.slice(index, end + 2));
      index = end + 2;
    } else if (/\s/u.test(char)) {
      if (current !== null) args.push(current);
      current = null;
      index += 1;
    } else if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return { ok: false, error: "unclosed ' in command" };
      add(command.slice(index + 1, end));
      index = end + 1;
    } else if (char === '"') {
      let text = "";
      index += 1;
      while (index < command.length && command.charAt(index) !== '"') {
        if (command.charAt(index) === "\\") index += 1;
        text += command.charAt(index);
        index += 1;
      }
      if (index >= command.length) {
        return { ok: false, error: 'unclosed " in command' };
      }
      add(text);
      index += 1;
    } else if (char === "\\") {
      add(command.charAt(index + 1));
      index += 2;
    } else {
      add(char);
      index += 1;
    }
  }
  if (current !== null) args.push(current);
  return { ok: true, args };
};

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
      runScope(context.inputs, context.outputs, context.runId),
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
  const tokens = tokenize(node.command);
  if (!tokens.ok) return tokens;
  const args: string[] = [];
  for (const token of tokens.args) {
    const rendered = render(token, context);
    if (!rendered.ok) return rendered;
    args.push(rendered.value);
  }
  if (node.type === "tool.gh") return { ok: true, program: "gh", args };
  if (node.type === "tool.aws") {
    const extra = [
      ...(node.profile === undefined ? [] : ["--profile", node.profile]),
      ...(node.region === undefined ? [] : ["--region", node.region]),
    ];
    return { ok: true, program: "aws", args: [...args, ...extra] };
  }
  const [program, ...rest] = args;
  if (program === undefined || program === "") {
    return { ok: false, error: "the command names no program" };
  }
  return { ok: true, program, args: rest };
};

/** Keeps the first `OUTPUT_LIMIT` characters; the rest goes to a file. */
const capped = (text: string, file: () => string): string => {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n… (truncated; the full output is in ${file()})`;
};

const failed = (error: string): NodeResult => ({
  ok: false,
  output: { exitCode: -1, stdout: "", stderr: error },
  error,
});

/** Runs a user's CLI: `gh`, `aws` or any program, with its own login. */
export const toolExecutor =
  (runner: ToolRunner): NodeExecutor =>
  async context => {
    const { node } = context;
    if (
      node.type !== "tool.gh" &&
      node.type !== "tool.aws" &&
      node.type !== "tool.shell"
    ) {
      return failed(`${context.id} is not a tool node`);
    }
    const command = commandOf(node, context);
    if (!command.ok) return failed(command.error);
    const checked =
      node.type === "tool.shell"
        ? [command.program, ...command.args]
        : command.args;
    if (!isAllowed(checked, node.allow)) {
      return failed(
        `"${checked.join(" ")}" is not in the node's allow list (${(node.allow ?? []).join(", ")})`,
      );
    }
    let cwd = context.cwd;
    if (node.cwd !== undefined) {
      const rendered = render(node.cwd, context);
      if (!rendered.ok) return failed(rendered.error);
      cwd = path.resolve(context.cwd, rendered.value);
    }
    context.emit({
      type: "tool.called",
      id: context.id,
      name: command.program,
      input: { command: [command.program, ...command.args].join(" ") },
    });
    const run = await runner(command.program, command.args, {
      cwd,
      signal: context.signal,
    });
    const keep = (stream: "stdout" | "stderr") => () => {
      const dir = path.join(context.cwd, ".ork", "runs", context.runId);
      mkdirSync(dir, { recursive: true });
      const file = path.join(
        dir,
        `${context.id}.${String(context.round)}.${stream}.txt`,
      );
      writeFileSync(file, run[stream]);
      return path.relative(context.cwd, file);
    };
    const output = {
      exitCode: run.exitCode,
      stdout: capped(run.stdout, keep("stdout")),
      stderr: capped(run.stderr, keep("stderr")),
    };
    context.emit({
      type: "tool.result",
      id: context.id,
      isError: run.exitCode !== 0,
    });
    if (run.exitCode === 0) return { ok: true, output };
    const last = run.stderr.trim().split("\n").at(-1) ?? "";
    return {
      ok: false,
      output,
      error: `${command.program} exited with ${String(run.exitCode)}${last === "" ? "" : `: ${last}`}`,
    };
  };

/** The real runner: `spawn` without a shell, output collected as text. */
export const spawnTool: ToolRunner = (program, args, { cwd, signal }) =>
  new Promise(resolve => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(program, args, {
      cwd,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr.push(chunk);
    });
    child.on("error", error => {
      resolve({
        exitCode: -1,
        stdout: stdout.join(""),
        stderr: `could not run ${program}: ${error.message}`,
      });
    });
    child.on("close", code => {
      resolve({
        exitCode: code ?? -1,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      });
    });
  });
