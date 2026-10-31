/**
 * @file Tests for `ork agents`: the list shows where each agent comes from and
 *   what shadows it, `show` prints its settings and role, and `add --from`
 *   copies a project's agent into `.ork/agents`, where it wins.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type AgentCatalog,
  type CatalogAgent,
  catalogAgent,
  loadAgents,
} from "@krapht/ork-core";
import { describe, expect, it } from "vitest";

import { addAgent, formatAgent, formatAgents } from "../src/index.ts";

const temp = (prefix: string): string =>
  realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

const found = (catalog: AgentCatalog, name: string): CatalogAgent => {
  const agent = catalogAgent(catalog, name);
  if (agent === undefined) throw new Error(`no ${name}`);
  return agent;
};

describe("ork agents", () => {
  it("lists, shows, and copies a project's agent into .ork/agents", () => {
    const root = temp("ork-cli-agents-");
    const home = temp("ork-home-");
    mkdirSync(path.join(root, ".ai/agents"), { recursive: true });
    writeFileSync(
      path.join(root, ".ai/agents/reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews changes.\n---\n\nReview strictly.\n",
    );
    mkdirSync(path.join(root, ".claude"));
    symlinkSync("../.ai/agents", path.join(root, ".claude/agents"));
    const catalog = () => loadAgents({ projectRoot: root, home });

    expect(formatAgents(catalog())).toEqual([
      "reviewer  project  .ai/agents/reviewer.md (via .claude/agents)  Reviews changes.",
    ]);
    expect(formatAgents(loadAgents({ home }))).toEqual([
      "No agents yet. Add one with ork agents add <name>, or put agents in .claude/agents.",
    ]);

    expect(
      addAgent({
        scope: "project",
        projectRoot: root,
        name: "reviewer",
        model: "opus",
        from: found(catalog(), "reviewer"),
      }),
    ).toMatchObject({ ok: true });
    expect(
      readFileSync(path.join(root, ".ork/agents/reviewer.agent.yaml"), "utf8"),
    ).toContain("model: opus");

    expect(formatAgents(catalog())).toEqual([
      "reviewer  project  .ai/agents/reviewer.md (via .claude/agents)  shadowed by .ork/agents/reviewer.md",
      "reviewer  project  .ork/agents/reviewer.md  Reviews changes.",
    ]);
    const shown = formatAgent(found(catalog(), "reviewer"));
    expect(shown.slice(0, 2)).toEqual(["reviewer", "Reviews changes."]);
    expect(shown).toContain("  model: opus");
    expect(shown).toContain("  Review strictly.");
  });
});
