/**
 * @file What a resolved context stack adds to a session: the context files as
 *   appended system-prompt sections, the per-node plugin folder that carries
 *   Ork's skills as `ork:<name>`, and the settings that switch project skills
 *   and instructions off.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ContextFile, ContextLayer } from "./files.ts";
import type { ContextStack } from "./resolve.ts";

/** The plugin's name, and so the namespace of its skills. */
export const PLUGIN_NAME = "ork";

const HEADINGS: Record<ContextLayer, string> = {
  user: "# Your context",
  workflow: "# Workflow context",
  node: "# Context for this node",
};

/** One appended section per layer that has files, each file under its name. */
export const contextSections = (
  files: readonly ContextFile[],
  layer: ContextLayer,
): string[] => {
  const mine = files.filter(f => f.layer === layer);
  if (mine.length === 0) return [];
  return [
    [
      HEADINGS[layer],
      ...mine.map(f => `## ${f.name}\n\n${f.text.trim()}`),
    ].join("\n\n"),
  ];
};

/**
 * Claude Code settings for the session (`--settings`): `skillOverrides`
 * switches off project skills that are shadowed or left out, and
 * `project.instructions: ignore` excludes the checkout's CLAUDE.md files, rules
 * and AGENTS.md. `undefined` when there is nothing to set.
 */
export const sessionSettings = (
  stack: ContextStack,
  checkout: string,
): Record<string, unknown> | undefined => {
  const settings: Record<string, unknown> = {};
  if (stack.projectOff.length > 0) {
    settings["skillOverrides"] = Object.fromEntries(
      stack.projectOff.map(name => [name, "off"]),
    );
  }
  if (stack.instructions === "ignore") {
    settings["claudeMdExcludes"] = [
      path.join(checkout, "**", "CLAUDE.md"),
      path.join(checkout, "**", "CLAUDE.local.md"),
      path.join(checkout, ".claude", "rules", "**"),
    ];
    // Claude Code's built-in plugin that reads AGENTS.md.
    settings["pluginConfigs"] = {
      "cc-plugin-agents-md@builtin": {
        options: { instructionFiles: "claude-md" },
      },
    };
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
};

/**
 * Writes the node's plugin: `.claude-plugin/plugin.json` and a copy of each
 * skill Ork loads. Returns its folder, or `null` when there is no skill.
 */
export const writePlugin = (
  stack: ContextStack,
  dir: string,
  description: string,
): string | null => {
  if (stack.plugin.length === 0) return null;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(dir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: PLUGIN_NAME, version: "0.0.0", description }, undefined, 2)}\n`,
  );
  for (const skill of stack.plugin) {
    cpSync(skill.dir, path.join(dir, "skills", skill.name), {
      recursive: true,
      dereference: true,
    });
  }
  return dir;
};
