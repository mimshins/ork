/**
 * @file Tests for `ork doctor`'s checks, against a fake `exec`, what it says of
 *   triggers, against a store in a temp `~`, and whether a run's socket path
 *   fits under `~`, and the `ork` MCP entries a stopped Command Code session
 *   left, which it removes.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type EventStore,
  inRepoPlace,
  openStore,
  readProjectTriggers,
  storePath,
  takeWatchLock,
} from "@krapht/ork-core";
import type { Exec } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

import {
  checkNode,
  exec,
  formatCheck,
  headWarning,
  leaseChecks,
  runChecks,
  socketCheck,
  triggerChecks,
} from "../src/index.ts";

/** A fake `exec`: maps "program arg arg" to stdout; anything else fails. */
const fakeExec =
  (outputs: Record<string, string>): Exec =>
  (program, args) => {
    const key = [program, ...args].join(" ");
    const stdout = outputs[key];
    return Promise.resolve(
      stdout === undefined ? { ok: false, stdout: "" } : { ok: true, stdout },
    );
  };

const loggedIn = {
  "git --version": "git version 2.50.0\n",
  "git rev-parse --is-inside-work-tree": "true\n",
  "git rev-parse --verify HEAD": "abc123\n",
  "git config user.name": "Some One\n",
  "git config user.email": "someone@example.com\n",
  "claude --version": "2.1.314 (Claude Code)\n",
  "claude auth status --json": JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    email: "someone@example.com",
  }),
  "gh --version": "gh version 2.80.0\n",
  "gh auth status --json hosts": JSON.stringify({
    hosts: {
      "github.com": [{ active: true, state: "success", login: "octocat" }],
    },
  }),
};

describe("ork doctor", () => {
  it("passes with the claude-code driver logged in, and never prints the email", async () => {
    const { results, ok } = await runChecks(fakeExec(loggedIn), {}, "24.20.0");
    expect(ok).toBe(true);
    expect(results.map(r => `${r.name}: ${r.status}`)).toEqual([
      "node: ok",
      "git: ok",
      "git repo: ok",
      "git commits: ok",
      "claude (claude-code driver): ok",
      "opencode (open-code driver): skip",
      "cmd (command-code driver): skip",
      "gh: ok",
      "aws: skip",
      "git identity: ok",
    ]);
    expect(JSON.stringify(results)).not.toContain("someone@example.com");
  });

  it("warns, and still passes, when the repository has no commit", async () => {
    const { "git rev-parse --verify HEAD": _, ...noHead } = loggedIn;
    const { results, ok } = await runChecks(fakeExec(noHead), {}, "24.20.0");
    expect(ok).toBe(true);
    expect(results.filter(r => r.name === "git commits")).toMatchObject([
      { status: "warn", detail: "no commit yet" },
    ]);
  });

  it("tells init of a repository with no commit, and of no one else", async () => {
    const inside = {
      "git --version": "git version 2.50.0",
      "git rev-parse --is-inside-work-tree": "true\n",
    };
    expect(await headWarning(fakeExec(inside))).toContain("no commit yet");
    expect(await headWarning(fakeExec(loggedIn))).toBeNull();
    expect(
      await headWarning(fakeExec({ "git --version": "git version 2.50.0" })),
    ).toBeNull();
  });

  it("accepts an API key or a cloud provider for claude-code without a login", async () => {
    const run = fakeExec({
      "git --version": "git version 2.50.0",
      "claude --version": "2.1.314 (Claude Code)\n",
      "claude auth status --json": JSON.stringify({ loggedIn: false }),
    });
    const withKey = await runChecks(run, { ANTHROPIC_API_KEY: "x" }, "24.20.0");
    const withBedrock = await runChecks(
      run,
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      "24.20.0",
    );
    expect(withKey.ok).toBe(true);
    expect(withBedrock.results[3]?.detail).toBe(
      "2.1.314 (Claude Code), Amazon Bedrock (CLAUDE_CODE_USE_BEDROCK)",
    );
    expect(JSON.stringify(withKey.results)).not.toContain('"x"');
  });

  it("fails without any agent driver", async () => {
    const { ok, results } = await runChecks(
      fakeExec({ "git --version": "git version 2.50.0" }),
      {},
      "24.20.0",
    );
    expect(ok).toBe(false);
    expect(
      results.find(r => r.name === "claude (claude-code driver)")?.status,
    ).toBe("warn");
  });

  it("fails on an old Node or a missing git", async () => {
    expect(checkNode("22.12.0").status).toBe("fail");
    expect(checkNode("24.20.1").status).toBe("ok");
    const { ok } = await runChecks(fakeExec(loggedIn), {}, "24.2.0");
    expect(ok).toBe(false);
  });

  it("prints a hint under a problem", () => {
    expect(
      formatCheck({ name: "gh", status: "warn", detail: "d", hint: "do x" }),
    ).toEqual(["! gh                   d", "  do x"]);
  });
});

/** A store in a temp `~`, with a project declaring one trigger `t`. */
const triggerHome = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-doctor-"));
  const home = path.join(root, "home");
  const dir = path.join(root, "project", ".ork");
  mkdirSync(path.join(dir, "workflows"), { recursive: true });
  writeFileSync(
    path.join(dir, "workflows", "triage.ork.yaml"),
    "schemaVersion: 1\nname: triage\nnodes:\n  a: { type: tool.shell, command: x }\nlimits: { budgetUsd: 1 }\n",
  );
  writeFileSync(
    path.join(dir, "triggers.yaml"),
    "schemaVersion: 1\ntriggers:\n  t: { every: 1m, run: triage }\n",
  );
  const store = openStore(storePath(home));
  const place = store.addProject({
    id: "p",
    root: path.dirname(dir),
    mode: "in-repo",
    dir,
  });
  return { home, dir, place, store };
};

/** Accepts `t` as a person would, which makes it live. */
const accepted = (given: ReturnType<typeof triggerHome>): EventStore => {
  const [item] = readProjectTriggers(given.place).triggers;
  if (item === undefined) throw new Error("no trigger");
  given.store.acceptTrigger("p", item.id, item.hash);
  return given.store;
};

const unparsable = (file: string): void => {
  writeFileSync(file, "triggers: [not, what, it, wants\n");
};

const aFolder = (file: string): void => {
  rmSync(file);
  mkdirSync(file);
};

/** A `~` whose longest socket path is `bytes` long: `/h/.ork/…` is 34. */
const socketHome = (bytes: number) => `/${"h".repeat(bytes - 33)}`;

describe("ork doctor on sockets", () => {
  it("passes a home whose longest socket path fits", () => {
    expect(socketCheck(socketHome(103), "darwin")).toEqual({
      name: "sockets",
      status: "ok",
      detail: "103 of 103 bytes",
    });
    expect(socketCheck(socketHome(107), "linux")).toMatchObject({
      status: "ok",
    });
  });

  it("warns of one past the limit, and says what slows down", () => {
    const past = socketCheck(socketHome(104), "darwin");
    expect(past).toMatchObject({
      status: "warn",
      detail:
        "a run's socket path is 104 bytes, past the 103 this system allows",
    });
    expect(past.hint).toContain("wait up to a second");
    expect(socketCheck(socketHome(108), "linux")).toMatchObject({
      status: "warn",
    });
  });

  it("says nothing is wrong where sockets are not Unix sockets", () => {
    expect(socketCheck(socketHome(300), "win32")).toMatchObject({
      status: "ok",
    });
  });
});

describe("ork doctor on triggers", () => {
  it("warns of a live trigger with nothing watching", () => {
    const given = triggerHome();
    accepted(given).close();
    expect(triggerChecks(given.home)).toEqual([
      {
        name: "ork watch",
        status: "warn",
        detail: "not looking: t",
        hint: "Start it with `ork watch --detach`.",
      },
    ]);
  });

  it("is content when something is watching it", () => {
    const given = triggerHome();
    const store = accepted(given);
    expect(takeWatchLock(store).ok).toBe(true);
    store.close();
    expect(triggerChecks(given.home)).toEqual([
      { name: "ork watch", status: "ok", detail: "1 trigger(s) looking" },
    ]);
  });

  it("says nothing of a trigger nobody has accepted", () => {
    const given = triggerHome();
    given.store.close();
    expect(triggerChecks(given.home)).toEqual([]);
  });

  it.each([
    ["is no YAML", unparsable],
    ["is a folder", aFolder],
  ])("warns of a file it can't read, that %s", (_, spoil) => {
    const given = triggerHome();
    given.store.close();
    const file = path.join(given.dir, "triggers.yaml");
    spoil(file);
    const [check, ...rest] = triggerChecks(given.home);
    expect(rest).toEqual([]);
    expect(check).toMatchObject({
      name: "triggers",
      status: "warn",
      hint: "Its triggers are off until it can be read.",
    });
    expect(check?.detail).toContain(file);
  });
});

/**
 * A project whose runs folder holds the lease of a Command Code session that
 * stopped in a checkout since removed, and that checkout's local scope in a
 * temp `~`, with the user's own `other` entry beside Ork's.
 */
const staleLease = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ork-doctor-lease-"));
  const home = path.join(root, "home");
  const entry = path.join(home, ".commandcode", "projects", "gone", "mcp.json");
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(
    entry,
    JSON.stringify({
      mcpServers: { other: { url: "http://x/1" }, ork: { url: "http://x/2" } },
    }),
  );
  const place = inRepoPlace(path.join(root, "project"));
  const ledger = path.join(place.dir, "runs", ".leases");
  mkdirSync(ledger, { recursive: true });
  const folder = path.join(root, "gone");
  writeFileSync(
    path.join(ledger, "gone.json"),
    JSON.stringify({ id: "l1", folder, pid: 0, entry }),
  );
  return { place, home, entry, folder, ledger };
};

describe("ork doctor on Command Code leases", () => {
  it("removes the ork entry a stopped session left and says so", async () => {
    const given = staleLease();
    const results = await leaseChecks(given.place, { HOME: given.home });
    expect(results).toEqual([
      {
        name: "command-code",
        status: "ok",
        detail: `removed the \`ork\` MCP entry a stopped session left in ${given.folder}`,
      },
    ]);
    expect(JSON.parse(readFileSync(given.entry, "utf8"))).toEqual({
      mcpServers: { other: { url: "http://x/1" } },
    });
    expect(readdirSync(given.ledger)).toEqual([]);
  });

  it("says nothing when no lease was left", async () => {
    const place = inRepoPlace(mkdtempSync(path.join(tmpdir(), "ork-doctor-")));
    expect(await leaseChecks(place, {})).toEqual([]);
  });
});

/** A fixture of the runtime package: the stand-ins QA puts on `PATH`. */
const fixture = (name: string): string =>
  fileURLToPath(
    new URL(`../../runtime/test/fixtures/${name}`, import.meta.url),
  );

/**
 * Runs `body` with `PATH` set to `dir` (and node's own folder), then restores
 * it.
 */
const withPath = async <T>(dir: string, body: () => Promise<T>): Promise<T> => {
  const saved = process.env["PATH"];
  process.env["PATH"] = [dir, path.dirname(process.execPath)].join(
    path.delimiter,
  );
  try {
    return await body();
  } finally {
    process.env["PATH"] = saved;
  }
};

describe("ork doctor with the QA stand-ins", () => {
  it("reports the claude-code driver ok with only fake claude and fake cmd on PATH", async () => {
    const bin = mkdtempSync(path.join(tmpdir(), "ork-doctor-bin-"));
    symlinkSync(fixture("fake-claude.mjs"), path.join(bin, "claude"));
    symlinkSync(fixture("fake-command.mjs"), path.join(bin, "cmd"));
    const { results } = await withPath(bin, () =>
      runChecks(exec, {}, "24.20.0"),
    );
    rmSync(bin, { recursive: true, force: true });
    expect(
      results
        .map(r => `${r.name}: ${r.status}`)
        .filter(l => /driver\)/u.test(l)),
    ).toEqual([
      "claude (claude-code driver): ok",
      "opencode (open-code driver): skip",
      "cmd (command-code driver): ok",
    ]);
  });
});
