/**
 * @file A follow-up as markdown, for the `file` store's entry and a `github`
 *   issue's body: who acts, the kind and when it is due, the files, the body, a
 *   message's draft and a task's steps with their commands, shown and never
 *   run.
 */

import type { FollowUp } from "./types.ts";

const code = (text: string): string => `\`${text.replaceAll("`", "'")}\``;

/** The follow-up's details and text, without its title. */
export const followUpMarkdown = (f: FollowUp): string => {
  const origin = [
    f.from.run === undefined ? "" : `run ${code(f.from.run)}`,
    f.from.node === undefined ? "" : `node ${code(f.from.node)}`,
  ].filter(part => part !== "");
  const facts = [
    code(f.id),
    `for **${f.for}**`,
    f.kind,
    `due **${f.due}**`,
    ...(origin.length === 0 ? [] : [`from ${origin.join(" ")}`]),
    ...(f.ref === undefined ? [] : [`waits on ${code(f.ref)}`]),
  ];
  const lines = [facts.join(" · ")];
  if (f.where.length > 0) {
    lines.push("", `Where: ${f.where.map(w => code(w)).join(", ")}`);
  }
  if (f.body !== "") lines.push("", f.body);
  if (f.draft !== undefined) {
    const channel =
      f.draft.channel === undefined ? "" : ` (${f.draft.channel})`;
    lines.push(
      "",
      `Draft to **${f.draft.to}**${channel}:`,
      "",
      ...f.draft.text.split("\n").map(line => `> ${line}`),
    );
  }
  if (f.steps !== undefined && f.steps.length > 0) {
    lines.push("", "Steps (Ork never runs them):", "");
    for (const [index, step] of f.steps.entries()) {
      lines.push(`${String(index + 1)}. ${step.text}`);
      if (step.command !== undefined) {
        lines.push("", "   ```sh", `   ${step.command}`, "   ```");
      }
    }
  }
  return lines.join("\n");
};
