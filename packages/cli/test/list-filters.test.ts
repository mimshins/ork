/**
 * @file The table-derived test of RFC-017: every list command, taken from the
 *   real command tree, is checked against its field table. For each field the
 *   flag exists (an enum's `options` equal the table's values, plus `all`), a
 *   wrong value is refused naming the flag, and Tab completion offers the flag
 *   and its values. `--ids` and `--limit` exist exactly where a list has them,
 *   no list takes `--all`, and `prune --all` is untouched.
 */

import {
  ALL,
  decisionListTable,
  feedbackListTable,
  followUpListTable,
  type ListField,
  type ListTable,
  runListTable,
  usageListTable,
  worktreeListTable,
} from "@krapht/ork-core";
import { type ArgsDef, type CommandDef, runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agentListTable } from "../src/agents/table.ts";
import { projectListTable } from "../src/commands/projects.ts";
import { VALUE_PROVIDERS, providerFor } from "../src/completion/values.ts";
import {
  argsOf,
  completionLines,
  main,
  renderHelp,
  resolved,
} from "../src/index.ts";
import { logListTable } from "../src/runs/logs.ts";
import { tempDir } from "./fixtures/completion.ts";

type AnyTable = ListTable<never>;

type List = {
  /** What people type, and the command's path from `ork`. */
  name: string;
  path: string[];
  /** Words every call needs (`decide` lists only with `--list`; `logs` a run). */
  base: string[];
  table: AnyTable;
  ids: boolean;
  limit: boolean;
};

const LISTS: List[] = [
  {
    name: "ps",
    path: ["ps"],
    base: [],
    table: runListTable,
    ids: true,
    limit: true,
  },
  {
    name: "usage",
    path: ["usage"],
    base: [],
    table: usageListTable,
    ids: false,
    limit: false,
  },
  {
    name: "decide",
    path: ["decide"],
    base: ["--list"],
    table: decisionListTable,
    ids: true,
    limit: true,
  },
  {
    name: "follow-ups list",
    path: ["follow-ups", "list"],
    base: [],
    table: followUpListTable,
    ids: true,
    limit: true,
  },
  {
    name: "feedback list",
    path: ["feedback", "list"],
    base: [],
    table: feedbackListTable,
    ids: true,
    limit: true,
  },
  {
    name: "worktrees list",
    path: ["worktrees", "list"],
    base: [],
    table: worktreeListTable,
    ids: true,
    limit: true,
  },
  {
    name: "agents list",
    path: ["agents", "list"],
    base: [],
    table: agentListTable,
    ids: true,
    limit: true,
  },
  {
    name: "projects",
    path: ["projects"],
    base: [],
    table: projectListTable,
    ids: true,
    limit: true,
  },
  {
    name: "logs",
    path: ["logs"],
    base: ["some-run"],
    table: logListTable,
    ids: false,
    limit: true,
  },
];

const fieldsOf = (list: List): readonly ListField<never>[] => list.table.fields;

/** The real command at `names` under `ork`. */
const commandAt = async (
  names: readonly string[],
  parent: CommandDef = main,
): Promise<CommandDef> => {
  const [first, ...rest] = names;
  if (first === undefined) return parent;
  const next = (await resolved(parent.subCommands ?? {}))[first];
  if (next === undefined) throw new Error(`no command ${first}`);
  return commandAt(rest, await resolved(next));
};

/** The command's flags and positionals, hidden ones too. */
const argsAt = async (names: readonly string[]): Promise<ArgsDef> =>
  argsOf(await commandAt(names));

/** What an enum field's flag must offer: its values, and `all` when taken. */
const optionsOf = (field: ListField<never>): string[] => [
  ...(field.values ?? []),
  ...(field.all === true ? [ALL] : []),
];

/** A value the field can't take. */
const badValue = (field: ListField<never>): string =>
  field.type === "for" ? "nobody" : "banana-split";

/** The error that refuses `bad` for `field`: `--project` is checked later. */
const refusal = (field: ListField<never>, bad: string): RegExp =>
  field.type === "text"
    ? new RegExp(`No registered project \`${bad}\`; registered: none\\.`, "u")
    : new RegExp(`--${field.name} takes .*, not \`${bad}\`\\.`, "u");

/** The flags every list with ids and a limit has beside its fields. */
const sharedFlags = (list: List): string[] => [
  ...(list.ids ? ["--ids"] : []),
  ...(list.limit ? ["--limit"] : []),
  "--json",
];

type Ran = { out: string; err: string; code: number | string | undefined };

/** Runs the real command with `words` in a throwaway home; what it printed. */
const ork = async (list: List, ...words: string[]): Promise<Ran> => {
  vi.stubEnv("HOME", tempDir("ork-lists-"));
  vi.stubEnv("ORK_PLAIN", "1");
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(text => {
    out += String(text);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(text => {
    err += String(text);
    return true;
  });
  process.exitCode = undefined;
  try {
    await runCommand(await commandAt(list.path), {
      rawArgs: [...list.base, ...words],
    });
  } catch (error) {
    // citty refuses a value outside an enum's options itself.
    err += error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  const code = process.exitCode;
  process.exitCode = undefined;
  return { out, err, code };
};

/** The candidates (values only) for `words`, outside any project. */
const offers = async (...words: string[]): Promise<string[]> =>
  (await completionLines(main, words, tempDir("ork-lists-cwd-"), "/none"))
    .filter(line => !line.startsWith(":"))
    .map(line => line.split("\t")[0] ?? "");

/** Every field of every list, as one case each. */
const FIELD_CASES: [string, List, ListField<never>][] = LISTS.flatMap(list =>
  fieldsOf(list).map((field): [string, List, ListField<never>] => [
    `${list.name} --${field.name}`,
    list,
    field,
  ]),
);

const ENUM_CASES = FIELD_CASES.filter(([, , field]) => field.type === "enum");
/** The fields a free word is not enough for: a bad value is refused. */
const CHECKED_CASES = FIELD_CASES.filter(
  ([, , field]) => field.type !== "text" || field.name === "project",
);
/** The text fields and the follow-up's `--for`: they have a value provider. */
const PROVIDED_CASES = FIELD_CASES.filter(
  ([, , field]) => field.type === "text" || field.type === "for",
);
/** Times and numbers: a free value, so completion offers none. */
const FREE_CASES = FIELD_CASES.filter(
  ([, , field]) => field.type === "since" || field.type === "until",
);

const LIMIT_CASES: [string, List, string][] = LISTS.filter(
  list => list.limit,
).flatMap(list =>
  ["0", "-1", "abc", "2.5"].map((bad): [string, List, string] => [
    list.name,
    list,
    bad,
  ]),
);
const IDS_LISTS = LISTS.filter(list => list.ids);
const PROJECT_LISTS = LISTS.filter(list =>
  fieldsOf(list).some(field => field.name === "project"),
);

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("every list's flags come from its table", () => {
  it.each(FIELD_CASES)(
    "%s is a flag of the real command",
    async (_, list, field) => {
      const args = await argsAt(list.path);
      expect(args).toHaveProperty([field.name]);
      expect(args[field.name]?.description).toBe(field.description);
    },
  );

  it.each(ENUM_CASES)(
    "%s takes the table's values as options",
    async (_, list, field) => {
      const arg = (await argsAt(list.path))[field.name];
      expect(arg).toMatchObject({ type: "enum", options: optionsOf(field) });
    },
  );

  it.each(FIELD_CASES.filter(([, , field]) => field.type !== "enum"))(
    "%s takes a free value",
    async (_, list, field) => {
      expect((await argsAt(list.path))[field.name]?.type).toBe("string");
    },
  );

  it.each(LISTS)(
    "$name has --ids, --limit exactly where intended",
    async list => {
      const args = await argsAt(list.path);
      expect("ids" in args).toBe(list.ids);
      expect("limit" in args).toBe(list.limit);
      expect(list.table.id !== undefined).toBe(list.ids);
    },
  );

  it.each(LISTS)("$name has --json", async list => {
    expect(await argsAt(list.path)).toHaveProperty(["json"]);
  });

  it("gives projects only --ids, --limit and --json", async () => {
    expect(Object.keys(await argsAt(["projects"])).toSorted()).toEqual([
      "ids",
      "json",
      "limit",
    ]);
  });

  it("gives usage no --ids and no --limit, and logs no --ids", async () => {
    const usage = await argsAt(["usage"]);
    expect(usage).not.toHaveProperty(["ids"]);
    expect(usage).not.toHaveProperty(["limit"]);
    expect(await argsAt(["logs"])).not.toHaveProperty(["ids"]);
    expect(await argsAt(["logs"])).toHaveProperty(["node"]);
  });
});

describe("every list refuses what its table does not take", () => {
  it.each(ENUM_CASES)(
    "%s refuses a value outside the enum, naming the flag and values",
    async (_, list, field) => {
      const ran = await ork(list, `--${field.name}`, "bogus");
      expect(ran.code).toBeTruthy();
      expect(ran.err).toContain(`--${field.name}`);
      for (const option of optionsOf(field)) expect(ran.err).toContain(option);
    },
  );

  it.each(CHECKED_CASES.filter(([, , field]) => field.type !== "enum"))(
    "%s refuses a value it can't read, naming the flag",
    async (_, list, field) => {
      const bad = badValue(field);
      const ran = await ork(list, `--${field.name}`, bad);
      expect(ran.code).toBe(1);
      expect(ran.out).toBe("");
      expect(ran.err).toMatch(refusal(field, bad));
    },
  );

  it.each(LIMIT_CASES)("$0 refuses --limit=$1", async (_, list, bad) => {
    const ran = await ork(list, `--limit=${bad}`);
    expect(ran.code).toBe(1);
    expect(ran.err).toBe(
      `--limit takes a positive whole number written in digits, not \`${bad}\`.\n`,
    );
  });

  it.each(IDS_LISTS)("$name refuses --ids with --json", async list => {
    const ran = await ork(list, "--ids", "--json");
    expect(ran.code).toBe(1);
    expect(ran.out).toBe("");
    expect(ran.err).toBe("--ids and --json can't be used together.\n");
  });
});

describe("Tab completion reads each list's table", () => {
  it.each(LISTS)("offers $name's flags", async list => {
    const flags = await offers(...list.path, "--");
    const own = fieldsOf(list).map(field => `--${field.name}`);
    expect(flags).toEqual(
      expect.arrayContaining([...own, ...sharedFlags(list)]),
    );
    expect(flags.includes("--ids")).toBe(list.ids);
    expect(flags.includes("--limit")).toBe(list.limit);
  });

  it.each(ENUM_CASES)("offers %s's values", async (_, list, field) => {
    const values = await offers(...list.path, `--${field.name}`, "");
    expect(values.toSorted()).toEqual(optionsOf(field).toSorted());
  });

  it.each(PROVIDED_CASES)("%s has a value provider", (_, list, field) => {
    expect(providerFor(VALUE_PROVIDERS, list.path, field.name)).toBeDefined();
  });

  it.each(FREE_CASES)(
    "%s is a free value, so completion offers none",
    async (_, list, field) => {
      expect(
        providerFor(VALUE_PROVIDERS, list.path, field.name),
      ).toBeUndefined();
      expect(await offers(...list.path, `--${field.name}`, "")).toEqual([]);
    },
  );

  it.each(PROJECT_LISTS)(
    "offers `all` for $name --project when no project is registered",
    async list => {
      expect(await offers(...list.path, "--project", "")).toEqual([ALL]);
    },
  );

  it("offers agent and me for follow-ups --for", async () => {
    expect(await offers("follow-ups", "list", "--for", "")).toEqual([
      "agent",
      "me",
    ]);
  });
});

describe("--all is gone from the lists, and kept by prune", () => {
  it.each(LISTS)("$name has no --all", async list => {
    expect(await argsAt(list.path)).not.toHaveProperty(["all"]);
  });

  it("keeps prune --all: public, in help and completion", async () => {
    const prune = await commandAt(["prune"]);
    const args = await argsOf(prune);
    expect(args["all"]?.description).toBe("Every project's runs");
    expect(await renderHelp(prune, main)).toContain("--all");
    expect(await offers("prune", "--")).toContain("--all");
  });
});

/** A flag the command does not take, and the list it is tried on. */
const UNKNOWN_FLAGS: [string, string, string[]][] = [
  ["ps", "--bogus", []],
  ["usage", "--ids", []],
  ["usage", "--limit", ["3"]],
  ["usage", "--status", ["x"]],
  ["logs", "--status", ["x"]],
  ["ps", "--all", []],
  ["decide", "--since", ["24h"]],
  ["follow-ups list", "--bogus", []],
  ["feedback list", "--bogus", []],
  ["worktrees list", "--bogus", []],
  ["agents list", "--bogus", []],
  ["projects", "--bogus", []],
];

/** The list named `name`. */
const listNamed = (name: string): List => {
  const found = LISTS.find(list => list.name === name);
  if (found === undefined) throw new Error(`no list ${name}`);
  return found;
};

describe("a list refuses a flag it does not have", () => {
  it.each(UNKNOWN_FLAGS)("%s %s", async (name, flag, value) => {
    const ran = await ork(listNamed(name), flag, ...value);
    expect(ran.code).toBe(1);
    expect(ran.out).toBe("");
    expect(ran.err).toBe(`Unknown flag \`${flag}\`.`);
  });

  /** Words a list takes: a positional, an alias, a negation, either spelling. */
  const KNOWN: [string, string[]][] = [
    ["ps", ["--no-json"]],
    ["ps", ["--ids"]],
    ["logs", ["-f", "--json"]],
    ["decide", ["--limit", "3", "--run", "nope"]],
    ["decide", ["--run-id", "nope"]],
    ["decide", ["--runId", "nope"]],
    ["follow-ups list", ["--project", "all"]],
    ["projects", ["--limit", "3"]],
  ];

  it.each(KNOWN)("%s takes %j", async (name, words) => {
    const ran = await ork(listNamed(name), ...words);
    expect(ran.err).not.toContain("Unknown flag");
  });

  it("leaves a subcommand's own flags to it: projects forget --yes", async () => {
    const ran = await ork(
      { ...listNamed("projects"), base: ["forget"] },
      "--yes",
    );
    expect(ran.err).not.toContain("Unknown flag");
  });
});
