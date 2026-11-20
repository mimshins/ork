/**
 * @file `permission`: the `claude` CLI's `--permission-prompt-tool`. A shell
 *   line gets Ork's verdict first (RFC-028): allowed when the node's rules and
 *   Ork's shipped reads cover it, denied by a deny rule, refused with a message
 *   on a node that refuses unlisted commands; anything else, and every other
 *   tool, goes to the run's `HumanChannel`, a shell line with the rules a
 *   person may allow past this call.
 */

import { homedir } from "node:os";
import path from "node:path";

import { type PathPlace, permissionVerdict, rulesFor } from "@krapht/ork-core";
import { z } from "zod";

import { type Denied, deniedRead, resolveInside } from "./contain.ts";
import { shellReadReason } from "./shell-reads.ts";
import { defineTool, text, type ToolContext } from "./tool.ts";

const isInside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
};

/**
 * Where a path a shell command reads lies: inside the session's folder (links
 * followed) or Ork's own (`~/.ork`), outside them, or denied by a `Read(...)`
 * rule or Ork's built-in secrets. Without a folder every path is outside.
 */
const placeOf = (
  cwd: string | undefined,
  denyRead: readonly string[] | undefined,
): ((word: string) => PathPlace) => {
  if (cwd === undefined) return () => "outside";
  let denied: Denied;
  try {
    denied = deniedRead(cwd, denyRead);
  } catch {
    // Settings Ork can't parse: no path is read without asking.
    return () => "denied";
  }
  return word => {
    // `~name` is another user's home folder.
    if (/^~[^/]/u.test(word)) return "denied";
    const target = path.resolve(cwd, word.replace(/^~/u, homedir()));
    if (denied(path.relative(cwd, target))) return "denied";
    try {
      return denied(resolveInside(cwd, target).rel) ? "denied" : "inside";
    } catch {
      return isInside(path.join(homedir(), ".ork"), target)
        ? "inside"
        : "outside";
    }
  };
};

const answer = (allow: boolean, input: unknown, message = "") =>
  text(
    JSON.stringify(
      allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message },
    ),
  );

/** Ork's verdict on a shell line, or `null` when a person decides. */
const verdictOf = (
  { rules, cwd, denyRead }: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
) => {
  const line = input["command"];
  if (rules === undefined || toolName !== "Bash" || typeof line !== "string") {
    return null;
  }
  const read = rules.reading === "open" ? undefined : shellReadReason(line);
  return permissionVerdict(line, {
    ...rules,
    ...(read === undefined ? {} : { shellRead: read }),
    place: placeOf(cwd, denyRead),
  });
};

export const permissionTool = defineTool({
  name: "permission",
  description: "Ork's permission prompt for the claude CLI.",
  shape: {
    tool_name: z.string(),
    input: z.record(z.string(), z.unknown()),
    tool_use_id: z.string().optional(),
  },
  // It is the prompt itself, named by --permission-prompt-tool.
  preapproved: false,
  available: ({ driver }) => driver === "claude-code",
  run: async (context, args) => {
    const verdict = verdictOf(context, args.tool_name, args.input);
    if (verdict?.verdict === "allow") return answer(true, args.input);
    if (verdict?.verdict === "deny" || verdict?.verdict === "refuse") {
      return answer(false, args.input, verdict.message);
    }
    // The rules a person may allow past this call; none when one has no rule.
    const rules =
      verdict === null
        ? null
        : rulesFor({ commands: verdict.uncovered }, () => false);
    const decision = await context.ports.human.permit({
      nodeId: context.nodeId,
      toolName: args.tool_name,
      input: args.input,
      ...(rules === null || rules.length === 0 ? {} : { rules }),
    });
    return decision.allow
      ? answer(true, args.input)
      : answer(false, args.input, decision.message);
  },
});
