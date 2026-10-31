/**
 * @file The git integration: `tool.git` nodes run the user's own `git`, so a
 *   commit can be an explicit step after the gates (ADR-034). A node may `add`
 *   and `commit` unless its `allow` says otherwise; `push` only when listed.
 *   Its output carries the staged changes, for a gate to show before a commit.
 */

import { defineIntegration } from "./integration.ts";

/** What a `tool.git` node may run when it sets no `allow`. */
export const GIT_ALLOW = ["add", "commit"] as const;

export const git = defineIntegration({
  id: "git",
  label: "Git",
  program: "git",
  options: {},
  args: () => [],
  allow: GIT_ALLOW,
  observe: {
    fields: ["staged", "diff", "head"],
    read: async run => {
      // One after another: git reads the index, and nothing here writes it.
      const staged = await run(["diff", "--cached", "--stat"]);
      const diff = await run(["diff", "--cached"]);
      const head = await run(["rev-parse", "--verify", "--quiet", "HEAD"]);
      return {
        staged: staged.ok ? staged.stdout.trimEnd() : "",
        diff: diff.ok ? diff.stdout : "",
        head: head.ok ? head.stdout.trim() : "",
      };
    },
  },
  doctor: async exec => {
    const name = await exec("git", ["config", "user.name"]);
    const email = await exec("git", ["config", "user.email"]);
    if (name.stdout.trim() === "" || email.stdout.trim() === "") {
      return {
        name: "git identity",
        status: "warn",
        detail:
          "user.name or user.email is not set (needed only to commit with tool.git)",
        hint: "Set them yourself (`git config --global user.name …`) before a tool.git node commits.",
      };
    }
    return {
      name: "git identity",
      status: "ok",
      detail: "user.name and user.email are set",
    };
  },
});
