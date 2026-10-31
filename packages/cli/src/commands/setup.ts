/**
 * @file Setting up: `ork init` scaffolds `.ork/` in a project, records it, and
 *   links the tool folders it uses; `ork link` points tools' agents and skills
 *   folders at `.ork/` (never in an attached project); `ork agents` lists,
 *   shows, adds and removes the agents nodes can take; `ork doctor` prints the
 *   environment checks (Node, git, the user's own claude, gh and aws logins,
 *   and the project's links) and fails when no Claude driver can run. Ork
 *   stores no credentials.
 */

import {
  catalogAgent,
  deleteAgent,
  linkTools,
  loadAgents,
  openStore,
  shownPath,
  toolLinks,
  toolsInUse,
} from "@krapht/ork-core";
import type { CheckResult } from "@krapht/ork-integrations";
import { defineCommand } from "citty";

import { addAgent, formatAgent, formatAgents } from "../agents/manage.ts";
import { exec, runChecks } from "../doctor/checks.ts";
import { style, write, writeErr } from "../output.ts";
import { initRecorded } from "../project/init.ts";
import { formatLinks, linkChecks } from "../project/link.ts";
import { projectAt } from "../project/place.ts";
import { WORKFLOW_DIR } from "../workflows.ts";

export const init = defineCommand({
  meta: {
    name: "init",
    description:
      "Set up .ork/ in this project with a starter workflow, and link the tool folders it uses",
  },
  args: {
    link: {
      type: "boolean",
      description:
        "Link .claude/agents and the like to .ork/ (--no-link: don't)",
      default: true,
    },
  },
  run: ({ args }) => {
    const store = openStore();
    let result: ReturnType<typeof initRecorded>;
    try {
      result = initRecorded(store, process.cwd(), { link: args.link });
    } finally {
      store.close();
    }
    if ("error" in result) {
      writeErr(result.error);
      process.exitCode = 1;
      return;
    }
    const { created, skipped, links } = result;
    for (const item of created) write(`${style("green", "created")} ${item}`);
    for (const item of skipped) write(`${style("dim", "exists")}  ${item}`);
    for (const line of formatLinks(links.filter(l => l.state !== "linked"))) {
      write(line);
    }
    write(
      `\nNext: edit ${WORKFLOW_DIR}/, then run ${style("bold", "ork validate")}.`,
    );
  },
});

export const link = defineCommand({
  meta: {
    name: "link",
    description:
      "Point tools' agents and skills folders (.claude/agents, …) at .ork/",
  },
  args: {
    check: {
      type: "boolean",
      description: "Only show each folder's state; change nothing",
      default: false,
    },
  },
  run: ({ args }) => {
    const place = projectAt(process.cwd());
    const { root } = place;
    if (place.mode === "attached") {
      write(
        `${root} is attached: Ork keeps its files in ${shownPath(place.dir, root)} and links nothing into the repository.`,
      );
      return;
    }
    const named = args._.map(String);
    const tools = named.length > 0 ? named : toolsInUse(root);
    if (tools.length === 0) {
      write(
        "No tool folders here yet; name the tools to link, e.g. ork link claude opencode.",
      );
      return;
    }
    if (args.check) {
      for (const line of formatLinks(toolLinks(root, tools))) write(line);
      return;
    }
    const result = linkTools(root, tools);
    if (!result.ok) {
      writeErr(result.error);
      process.exitCode = 1;
      return;
    }
    for (const line of formatLinks(result.links, result.created)) write(line);
  },
});

const MARK: Record<CheckResult["status"], string> = {
  ok: style("green", "✓"),
  warn: style("yellow", "!"),
  fail: style("red", "✗"),
  skip: style("dim", "-"),
};

export const formatCheck = (result: CheckResult): string[] => {
  const line = `${MARK[result.status]} ${result.name.padEnd(20)} ${result.detail}`;
  return result.hint === undefined
    ? [line]
    : [line, `  ${style("dim", result.hint)}`];
};

export const doctor = defineCommand({
  meta: {
    name: "doctor",
    description:
      "Check Node, git, and your own claude, gh, and aws logins (Ork stores no credentials)",
  },
  run: async () => {
    const { results, ok } = await runChecks(
      exec,
      process.env,
      process.versions.node,
    );
    const place = projectAt(process.cwd());
    for (const result of [
      ...results,
      ...(place.mode === "attached" ? [] : linkChecks(place.root)),
    ]) {
      for (const line of formatCheck(result)) write(line);
    }
    if (!ok) {
      write(
        `\n${style("red", "Not ready:")} Ork needs Node, git, and at least one Claude driver.`,
      );
      process.exitCode = 1;
    }
  },
});

const json = {
  type: "boolean",
  description: "Print JSON",
  default: false,
} as const;

const user = {
  type: "boolean",
  description: "Your own agents (~/.ork/agents) instead of the project's",
  default: false,
} as const;

const catalogHere = () => {
  const place = projectAt(process.cwd());
  return loadAgents({ projectRoot: place.root, orkDir: place.dir });
};

const scopeOf = (args: { user: boolean }) => {
  const place = projectAt(process.cwd());
  return {
    scope: args.user ? ("user" as const) : ("project" as const),
    projectRoot: place.root,
    orkDir: place.dir,
  };
};

const report = (result: ReturnType<typeof deleteAgent>, verb: string) => {
  if (!result.ok) {
    writeErr(result.error);
    process.exitCode = 1;
    return;
  }
  for (const file of result.files) write(`${style("green", verb)} ${file}`);
};

export const agents = defineCommand({
  meta: {
    name: "agents",
    description: "The agents nodes can take: list, show, add, rm",
  },
  subCommands: {
    list: defineCommand({
      meta: {
        name: "list",
        description: "Every agent, and where it comes from",
      },
      args: { json },
      run: ({ args }) => {
        const catalog = catalogHere();
        if (args.json) write(JSON.stringify(catalog.agents, undefined, 2));
        else for (const line of formatAgents(catalog)) write(line);
        for (const d of catalog.diagnostics) writeErr(d.message);
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description: "An agent's source, settings and role",
      },
      args: { name: { type: "positional", required: true }, json },
      run: ({ args }) => {
        const agent = catalogAgent(catalogHere(), args.name);
        if (agent === undefined) {
          writeErr(`No agent ${args.name}; see ork agents list.`);
          process.exitCode = 1;
          return;
        }
        if (args.json) write(JSON.stringify(agent, undefined, 2));
        else for (const line of formatAgent(agent)) write(line);
      },
    }),
    add: defineCommand({
      meta: {
        name: "add",
        description: "Add an agent to .ork/agents (or yours with --user)",
      },
      args: {
        name: { type: "positional", required: true },
        description: { type: "string", description: "When to use it" },
        model: { type: "string", description: "e.g. sonnet, opus, haiku" },
        from: { type: "string", description: "Copy an agent you already have" },
        user,
      },
      run: ({ args }) => {
        const from =
          args.from === undefined
            ? undefined
            : catalogAgent(catalogHere(), args.from);
        if (args.from !== undefined && from === undefined) {
          writeErr(`No agent ${args.from}; see ork agents list.`);
          process.exitCode = 1;
          return;
        }
        report(
          addAgent({
            ...scopeOf(args),
            name: args.name,
            ...(args.description === undefined
              ? {}
              : { description: args.description }),
            ...(args.model === undefined ? {} : { model: args.model }),
            ...(from === undefined ? {} : { from }),
          }),
          "created",
        );
      },
    }),
    rm: defineCommand({
      meta: {
        name: "rm",
        description: "Remove an agent from .ork/agents (or yours with --user)",
      },
      args: { name: { type: "positional", required: true }, user },
      run: ({ args }) => {
        report(deleteAgent(args.name, scopeOf(args)), "removed");
      },
    }),
  },
});
