/**
 * @file A stand-in for `ork` that a test SIGKILLs while a `git` from the
 *   worktree manager runs: it commits in the repository given as its first
 *   argument, whose `pre-commit` hook waits until the test lets it go.
 */

import { git } from "../../src/worktree/git.ts";

const [, , repo = ""] = process.argv;

await git(repo, ["commit", "-m", "work"]);
