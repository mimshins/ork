/**
 * @file A project's rules for the machine its runs share: the heavy commands
 *   (its full-suite checks), denied to the session of a node with `verify:`
 *   since Ork runs that check, and the OS priority, each with Ork's default.
 */

import {
  DEFAULT_PRIORITY,
  isClaudeNode,
  type Priority,
  type Project,
  type Workflow,
} from "@krapht/ork-schema";

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
