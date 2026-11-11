/**
 * @file The groups `ork --help` lists the commands in, kubectl-style, each
 *   command with a one-line description for the list (its own `--help` keeps
 *   the full one). The zsh completion menu labels commands with the same
 *   groups. A test fails when a command of `ork` is in no group, or in two.
 */

import type { CommandEntry } from "./command-tree.ts";

/** One command in a group: its name and the short line the list shows. */
export type GroupedCommand = { name: string; short: string };

/** A group of commands, in the order `ork --help` shows them. */
export type HelpGroup = { title: string; commands: GroupedCommand[] };

export const HELP_GROUPS: readonly HelpGroup[] = [
  {
    title: "Get started",
    commands: [
      { name: "init", short: "Set up Ork in this repository, in .ork/" },
      { name: "doctor", short: "Check Node, git and your own logins" },
      { name: "ui", short: "Open Ork's local UI in the browser" },
    ],
  },
  {
    title: "Workflows",
    commands: [
      { name: "validate", short: "Check workflow files" },
      { name: "run", short: "Run a workflow, or one node of it" },
      { name: "agents", short: "List, show, add and remove agents" },
      { name: "context", short: "Show what a node's session loads" },
      { name: "watch", short: "Start runs from each project's triggers" },
    ],
  },
  {
    title: "Runs",
    commands: [
      { name: "ps", short: "List this project's runs" },
      { name: "logs", short: "Print a run's transcript" },
      { name: "attach", short: "Follow a run here and answer its questions" },
      { name: "tree", short: "Show a run's tree, tokens and cost" },
      { name: "usage", short: "Show what runs spent over time" },
      { name: "resume", short: "Continue a run that didn't succeed" },
    ],
  },
  {
    title: "Steer a running run",
    commands: [
      { name: "decide", short: "Answer a run's open decisions" },
      { name: "chat", short: "Talk to a node of a run" },
      { name: "pause", short: "Pause a run, or one node" },
      { name: "continue", short: "Let a paused run or node go on" },
      { name: "stop", short: "Stop a run, or one node" },
      { name: "relay", short: "Let nodes of two runs message each other" },
    ],
  },
  {
    title: "After runs",
    commands: [
      { name: "feedback", short: "What got in the way in your runs" },
      { name: "worktrees", short: "Track and clean up Ork's worktrees" },
      { name: "prune", short: "Forget old runs' transcripts" },
    ],
  },
  {
    title: "Projects",
    commands: [
      { name: "projects", short: "List, forget or move registered projects" },
      { name: "register", short: "Attach a project from outside it" },
      { name: "migrate", short: "Move an attached project into its .ork/" },
      { name: "link", short: "Point tools' agent folders at .ork/" },
    ],
  },
  {
    title: "Ork itself",
    commands: [
      { name: "upgrade", short: "Upgrade Ork, the way it was installed" },
      { name: "mcp", short: "Serve Ork's tools to Claude Code (MCP)" },
      { name: "send", short: "Write to a session from a tool node's program" },
      { name: "once", short: "Run a check unless it passed on these files" },
      { name: "completion", short: "Print a tab-completion script" },
    ],
  },
];

/** What a command not in any group is listed under. */
export const OTHER_GROUP = "Other";

/** The group a root command is in, and its short line, if it has them. */
export const groupOf = (
  name: string,
): { title: string; short: string } | undefined => {
  for (const group of HELP_GROUPS) {
    const found = group.commands.find(command => command.name === name);
    if (found !== undefined) return { title: group.title, short: found.short };
  }
  return undefined;
};

/**
 * The shown commands in `HELP_GROUPS`'s order, then any in no group under
 * "Other", in the order the root command lists them.
 */
export const groupedEntries = (
  entries: readonly CommandEntry[],
): { title: string; entries: CommandEntry[] }[] => {
  const shown = entries.filter(entry => !entry.hidden);
  const grouped = HELP_GROUPS.map(group => ({
    title: group.title,
    entries: group.commands.flatMap(
      command => shown.find(entry => entry.name === command.name) ?? [],
    ),
  }));
  const other = shown.filter(entry => groupOf(entry.name) === undefined);
  return [...grouped, { title: OTHER_GROUP, entries: other }].filter(
    group => group.entries.length > 0,
  );
};
