/**
 * @file Tests for the warning `ork init` and `ork migrate --agents` print when
 *   linked tool folders or Ork's skills would reach every contributor's own
 *   agent tool, and for the doctor's check of CLAUDE.md and AGENTS.md under
 *   `.ork/`: when each is said, and that nothing is said when nothing is linked
 *   or written.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore } from "@krapht/ork-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { projectChecks } from "../src/doctor/project-checks.ts";
import { initSteps } from "../src/project/init-steps.ts";
import { knowledgeFilesIn, LINK_WARNING } from "../src/project/link.ts";
import { migrateHere } from "../src/project/migrate.ts";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const project = (): string => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-warn-")));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  mkdirSync(path.join(root, ".ork", "workflows"), { recursive: true });
  return root;
};

/** Runs `run` and returns what it wrote to stdout (plain: no terminal here). */
const printed = async (run: () => Promise<void>): Promise<string> => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
    lines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  await run();
  return lines.join("");
};

const steps = (
  root: string,
  options: { skills: boolean; link: boolean; linked?: boolean },
) =>
  printed(() =>
    initSteps(root, {
      issues: false,
      ...options,
    }),
  );

const migrating = (
  root: string,
  options: { agents: boolean; dryRun: boolean },
) =>
  printed(() =>
    migrateHere(root, { ...options, yes: true }, openStore(":memory:")),
  );

describe("the linking warning of ork init", () => {
  it("is printed when the skills are written", async () => {
    const out = await steps(project(), { skills: true, link: false });
    expect(out).toContain(LINK_WARNING);
  });

  it("is printed when tool folders were linked", async () => {
    const out = await steps(project(), {
      skills: false,
      link: true,
      linked: true,
    });
    expect(out).toContain(LINK_WARNING);
  });

  it("is not printed when nothing was written or linked", async () => {
    const out = await steps(project(), {
      skills: false,
      link: false,
      linked: false,
    });
    expect(out).not.toContain(LINK_WARNING);
  });
});

describe("the linking warning of ork migrate", () => {
  it.each([[false], [true]])(
    "is printed with --agents (dry run: %s)",
    async dryRun => {
      const out = await migrating(project(), { agents: true, dryRun });
      expect(out).toContain(LINK_WARNING);
    },
  );

  it("is not printed without --agents", async () => {
    const out = await migrating(project(), { agents: false, dryRun: false });
    expect(out).not.toContain(LINK_WARNING);
  });
});

describe("agent instructions under .ork/", () => {
  it("shows up in the doctor's project checks", () => {
    const root = project();
    expect(projectChecks(root).map(c => c.name)).not.toContain(
      "agent instructions under .ork/",
    );
    mkdirSync(path.join(root, ".ork", "context"), { recursive: true });
    writeFileSync(path.join(root, ".ork", "context", "CLAUDE.md"), "rules\n");
    expect(projectChecks(root)).toContainEqual(
      expect.objectContaining({
        name: "agent instructions under .ork/",
        status: "warn",
        detail: ".ork/context/CLAUDE.md",
      }),
    );
  });

  it("skips only the runs/ folder directly under .ork/", () => {
    const root = project();
    const ork = path.join(root, ".ork");
    for (const dir of ["runs/r1", "skills/runs"]) {
      mkdirSync(path.join(ork, dir), { recursive: true });
      writeFileSync(path.join(ork, dir, "AGENTS.md"), "x\n");
    }
    expect(knowledgeFilesIn(ork, true)).toEqual([
      path.join(ork, "skills", "runs", "AGENTS.md"),
    ]);
  });
});
