/**
 * @file Setting up: `ork init` scaffolds `.ork/` in a project, with a starter
 *   that names no driver (it says which a run takes here), records it, and
 *   links the tool folders it uses; `ork link` points tools' agents and skills
 *   folders at `.ork/` (never in an attached project); `ork agents` lists,
 *   shows, adds and removes the agents nodes can take. `ork doctor` and `ork
 *   upgrade` live in `install.ts`.
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
import { defineCommand } from "citty";

import {
  addAgent,
  agentListArgs,
  formatAgent,
  listAgents,
  refuseUnknownFlags,
} from "../agents/manage.ts";
import { exec, headWarning } from "../doctor/checks.ts";
import { style, write, writeErr } from "../output.ts";
import { initSteps } from "../project/init-steps.ts";
import {
  initDriverLineHere,
  initRecorded,
  STARTER_FILE,
} from "../project/init.ts";
import { formatLinks } from "../project/link.ts";
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
    skills: {
      type: "boolean",
      description:
        "Write Ork's skills for Claude Code into .ork/skills/ (--no-skills: don't; asked otherwise)",
    },
    issues: {
      type: "boolean",
      description:
        "Write the issues workflow (GitHub issues in parallel, one pull request) into .ork/workflows/ (--no-issues: don't; asked otherwise)",
    },
  },
  run: async ({ args }) => {
    const cwd = process.cwd();
    const driverLine = await initDriverLineHere(cwd);
    const store = openStore();
    let result: ReturnType<typeof initRecorded>;
    try {
      result = initRecorded(store, cwd, { link: args.link });
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
    if (driverLine !== null && created.includes(STARTER_FILE)) {
      write(driverLine);
    }
    for (const line of formatLinks(links.filter(l => l.state !== "linked"))) {
      write(line);
    }
    await initSteps(cwd, {
      skills: args.skills,
      issues: args.issues,
      link: args.link,
    });
    const noCommit = await headWarning(exec);
    if (noCommit !== null) write(style("yellow", `\n! git: ${noCommit}`));
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
    tools: {
      type: "positional",
      description:
        "The tools to link, e.g. claude opencode (default: the ones the project already uses)",
      required: false,
    },
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
      plugins: [refuseUnknownFlags],
      args: agentListArgs,
      run: ({ args }) => {
        const catalog = catalogHere();
        listAgents(catalog, args);
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
