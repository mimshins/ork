/**
 * @file What `ork init` offers after it scaffolds `.ork/`: Ork's skills for
 *   Claude Code and the `issues` workflow, each written on its flag, left out
 *   on its `--no-` flag, and asked about on a terminal otherwise. When init
 *   linked tool folders or wrote skills, it warns once that they reach every
 *   contributor's own agent tool.
 */

import { style, write } from "../output.ts";
import { issuesStep } from "./issues-step.ts";
import { LINK_WARNING } from "./link.ts";
import { skillsStep } from "./skills-step.ts";

export const initSteps = async (
  root: string,
  options: {
    skills: boolean | undefined;
    issues: boolean | undefined;
    link: boolean;
    /** Whether init just linked tool folders. */
    linked?: boolean;
  },
): Promise<void> => {
  const wrote = await skillsStep(root, {
    skills: options.skills,
    link: options.link,
  });
  if (wrote || options.linked === true) {
    write(style("yellow", `! ${LINK_WARNING}`));
  }
  await issuesStep(root, { issues: options.issues });
};
