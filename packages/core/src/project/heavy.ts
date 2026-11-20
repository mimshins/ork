/**
 * @file A project's rules for the machine its runs share: the heavy commands
 *   (its full-suite checks), denied to the session of a node with `verify:`
 *   since Ork runs that check, and the OS priority, each with Ork's default.
 *   Also the `verify.heavy` warning: a heavy `verify:` on a node that runs as
 *   many copies, each of which queues for a machine-wide slot.
 */

import {
  DEFAULT_PRIORITY,
  type Diagnostic,
  isClaudeNode,
  type Priority,
  type Project,
  type Workflow,
} from "@krapht/ork-schema";

import { warning } from "../graph/diagnostics.ts";

/** A `heavy` pattern as the Bash rule that denies it to a session. */
export const heavyRule = (pattern: string): string => `Bash(${pattern})`;

/**
 * The nodes, with the heavy commands denied to each Claude node that has
 * `verify:`; other nodes are left as they are. A pattern without `*` matches
 * only that command, so `vitest run` leaves `vitest run <files>` allowed.
 */
export const withoutHeavy = (
  nodes: Workflow["nodes"],
  heavy: readonly string[],
): Workflow["nodes"] => {
  if (heavy.length === 0) return nodes;
  const rules = heavy.map(pattern => heavyRule(pattern));
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) =>
      isClaudeNode(node) && "verify" in node && node.verify !== undefined
        ? [
            id,
            {
              ...node,
              tools: {
                ...node.tools,
                deny: [...new Set([...(node.tools?.deny ?? []), ...rules])],
              },
            },
          ]
        : [id, node],
    ),
  );
};

const words = (text: string): string => text.trim().replaceAll(/\s+/gu, " ");

/**
 * Whether `command` matches a `heavy` pattern, in the permission patterns'
 * syntax: `*` is any text, a trailing ` *` (or `:*`) also matches nothing, and
 * a pattern without `*` matches only that command.
 */
export const matchesPattern = (pattern: string, command: string): boolean => {
  const tail = words(pattern).replace(/:\*$/u, " *");
  const open = tail.endsWith(" *");
  const body = (open ? tail.slice(0, -2) : tail)
    .split("*")
    .map(part => part.replaceAll(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${open ? "(?: .*)?" : ""}$`, "su").test(
    words(command),
  );
};

/** Whether `command` is one of the project's heavy commands. */
export const isHeavy = (heavy: readonly string[], command: string): boolean =>
  heavy.some(pattern => matchesPattern(pattern, command));

/**
 * The commands of a shell script, as far as a heavy check can tell without a
 * shell: comments dropped, split at newlines, `;`, `&&`, `||`, `|` and `&` (not
 * the `&` of a redirect such as `2>&1`), each trimmed, without a leading
 * `VAR=value` or `then`/`do`/`else`. shortcut: it splits inside quotes too and
 * cannot see `eval`, variables, heredocs or called scripts (specs/gaps).
 */
export const scriptCommands = (script: string): string[] =>
  script
    .split("\n")
    .map(line => line.replace(/(?:^|\s)#.*$/u, ""))
    .flatMap(line => line.split(/&&|\|\||;|\||(?<![<>])&(?!>)/u))
    .map(part =>
      part
        .trim()
        .replace(/^(?:(?:then|do|else)(?:\s+|$))?(?:\w+=\S*\s+)*/u, ""),
    )
    .filter(part => part !== "");

/** Whether any command of a shell script is one of the project's heavy ones. */
export const isHeavyScript = (
  heavy: readonly string[],
  script: string,
): boolean =>
  heavy.length > 0 &&
  scriptCommands(script).some(command => isHeavy(heavy, command));

/** A project's rules for the machine a run shares, with Ork's defaults. */
export type MachineRules = { heavy: string[]; priority: Priority };

export const machineRulesOf = (project?: Project): MachineRules => ({
  heavy: project?.heavy ?? [],
  priority: project?.priority ?? DEFAULT_PRIORITY,
});

/**
 * Why a node can run as many copies at once, or `null` when it runs as one: a
 * `forEach` runs one per item, and a worker whose leader has `maxWorkers` can
 * be spawned that many times (`spawn_worker`).
 */
const copiesOf = (workflow: Workflow, id: string): string | null => {
  const node = workflow.nodes[id];
  if (node === undefined) return null;
  if ("forEach" in node && node.forEach !== undefined) {
    return "it runs once per forEach item";
  }
  if (node.type !== "agent.worker" || node.parent === undefined) return null;
  const owner = workflow.nodes[node.parent];
  const most = owner?.type === "agent.leader" ? (owner.maxWorkers ?? 0) : 0;
  return most > 0
    ? `its leader \`${node.parent}\` can spawn up to ${String(most)} of it with maxWorkers`
    : null;
};

/** The heavy command a `verify:` runs, or `null` when it runs none. */
const heavyVerifyOf = (
  heavy: readonly string[],
  verify: { command?: string | undefined; script?: string | undefined },
): { field: "command" | "script"; command: string } | null => {
  if (verify.command !== undefined && isHeavy(heavy, verify.command)) {
    return { field: "command", command: words(verify.command) };
  }
  const found =
    verify.script === undefined
      ? undefined
      : scriptCommands(verify.script).find(command => isHeavy(heavy, command));
  return found === undefined ? null : { field: "script", command: found };
};

/**
 * A warning for each node that runs as many copies and whose `verify:` runs one
 * of the project's heavy commands: each copy queues for one of the machine's
 * heavy slots (`ORK_HEAVY_SLOTS`), so the copies wait on each other's checks.
 */
export const checkHeavyVerify = (
  workflow: Workflow,
  heavy: readonly string[],
): Diagnostic[] => {
  if (heavy.length === 0) return [];
  return Object.entries(workflow.nodes).flatMap(([id, node]) => {
    const verify = "verify" in node ? node.verify : undefined;
    const found = verify === undefined ? null : heavyVerifyOf(heavy, verify);
    const why = found === null ? null : copiesOf(workflow, id);
    if (found === null || why === null) return [];
    return [
      warning(
        "verify.heavy",
        `verify: runs \`${found.command}\`, one of the project's heavy commands, on a node that runs as many copies (${why}): each copy queues for one of the machine's heavy slots, so the copies wait on each other's checks. Verify with a light check here (format, lint, typecheck) and run the full check on the owner or at the end`,
        ["nodes", id, "verify", found.field],
      ),
    ];
  });
};
