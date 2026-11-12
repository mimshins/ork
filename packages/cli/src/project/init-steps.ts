/**
 * @file What `ork init` offers after it scaffolds `.ork/`: Ork's skills for
 *   Claude Code and the `issues` workflow, each written on its flag, left out
 *   on its `--no-` flag, and asked about on a terminal otherwise.
 */

import { issuesStep } from "./issues-step.ts";
import { skillsStep } from "./skills-step.ts";

export const initSteps = async (
  root: string,
  options: {
    skills: boolean | undefined;
    issues: boolean | undefined;
    link: boolean;
  },
): Promise<void> => {
  await skillsStep(root, { skills: options.skills, link: options.link });
  await issuesStep(root, { issues: options.issues });
};
