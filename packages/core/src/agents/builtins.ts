/**
 * @file The agents that ship with Ork (G7 in specs/gaps.md, now closed): the
 *   lowest layer of the catalog, under the user's and the project's, so an
 *   agent of the same name anywhere else wins. Their names start with `ork-`,
 *   and their skills are Ork's built-ins.
 */

import type { Agent } from "@krapht/ork-schema";

/** The built-in agents by name. */
export const BUILTIN_AGENTS: Readonly<Record<string, Agent>> = {
  "ork-implementer": {
    description:
      "Makes the change a task asks for, with its tests, and reports what it did and did not verify.",
    instructions: [
      "You implement one task in this repository.",
      "Read the code around the change first and follow the project's own rules (AGENTS.md, CLAUDE.md, its specs). Make the smallest complete change: the code, its tests, and the docs it touches.",
      "Run the project's checks that cover your change when you may. End with a report that names the files you changed and says plainly what you did not verify.",
    ].join("\n\n"),
    skills: ["ork:report"],
  },
  "ork-reviewer": {
    description:
      "Reviews a change against its brief and the project's rules, and passes it or asks for changes.",
    instructions: [
      "You review a change; you never edit it.",
      "Read it with git, check it against what was asked and the project's own rules, and report `pass`, or `changes_requested` with findings: the file and line, what is wrong, why, and the fix you suggest.",
      "When the change comes back to you, check your earlier findings first.",
    ].join("\n\n"),
    isolation: "readonly",
    session: "resume",
    skills: ["ork:review", "ork:report"],
  },
};
