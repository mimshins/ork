/**
 * @file Tests for `ork doctor`'s checks, against a fake `exec`, what it says of
 *   triggers, against a store in a temp `~`, and whether a run's socket path
 *   fits under `~`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type EventStore,
  openStore,
  readProjectTriggers,
  storePath,
  takeWatchLock,
} from "@krapht/ork-core";
import type { Exec } from "@krapht/ork-integrations";
import { describe, expect, it } from "vitest";

import {
  checkNode,
  formatCheck,
  headWarning,
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
  it("passes with the CLI driver logged in, and never prints the email", async () => {
    const { results, ok } = await runChecks(fakeExec(loggedIn), {}, "24.20.0");
    expect(ok).toBe(true);
    expect(results.map(r => `${r.name}: ${r.status}`)).toEqual([
      "node: ok",
      "git: ok",
      "git repo: ok",
      "git commits: ok",
      "claude (sdk driver): warn",
      "claude (cli driver): ok",
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

  it("accepts an API key or a cloud provider for the SDK driver", async () => {
    const run = fakeExec({ "git --version": "git version 2.50.0" });
    const withKey = await runChecks(run, { ANTHROPIC_API_KEY: "x" }, "24.20.0");
    const withBedrock = await runChecks(
      run,
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      "24.20.0",
    );
    expect(withKey.ok).toBe(true);
    expect(withBedrock.results[3]?.detail).toBe("Amazon Bedrock");
    expect(JSON.stringify(withKey.results)).not.toContain('"x"');
  });

  it("fails without any Claude driver", async () => {
    const { ok, results } = await runChecks(
      fakeExec({ "git --version": "git version 2.50.0" }),
      {},
      "24.20.0",
    );
    expect(ok).toBe(false);
    expect(results.find(r => r.name === "claude (cli driver)")?.status).toBe(
      "warn",
    );
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
