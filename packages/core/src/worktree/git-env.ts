/**
 * @file Git's local environment variables, the ones a git hook sets (`GIT_DIR`,
 *   `GIT_INDEX_FILE`, …), and an environment without them. Ork finds a project
 *   by its path, never through these, so an `ork` started from a hook clears
 *   them at its entry, and core's git runner leaves them out for callers that
 *   don't start there (specs/worktrees.md).
 */

/**
 * What `git rev-parse --local-env-vars` prints (git 2.39.5). A fixed list, so
 * no git is spawned at every start; a test fails when the installed git names
 * one that is missing here.
 */
export const GIT_LOCAL_ENV: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** A copy of `env` without git's local variables. */
export const withoutGitLocalEnv = (
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const clean = { ...env };
  for (const name of GIT_LOCAL_ENV) delete clean[name];
  return clean;
};

/** Removes git's local variables from `env` in place (the CLI's entry). */
export const clearGitLocalEnv = (
  env: NodeJS.ProcessEnv = process.env,
): void => {
  for (const name of GIT_LOCAL_ENV) delete env[name];
};
