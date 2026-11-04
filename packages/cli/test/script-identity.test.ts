/**
 * @file The real `ork` with scripts: a workflow's tool nodes get their
 *   identity, pass JSON along and keep a secret out of the store, and a program
 *   in a run cannot use `ork chat` or accept a trigger.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { openStore, type RunEvent, storePath } from "@krapht/ork-core";
import { afterEach, describe, expect, it } from "vitest";

import { acceptRefusal } from "../src/commands/in-a-run.ts";

const BIN = path.resolve(import.meta.dirname, "../src/bin.ts");
const SECRET = "marker-secret-value-42";

const WORKFLOW = `schemaVersion: 1
name: scripted
nodes:
  pr:
    type: tool.shell
    command: sh -c 'printf "{\\"state\\":\\"OPEN\\",\\"token\\":\\"%s\\"}" "$TOKEN"'
    env:
      TOKEN: "{{env.ORK_TEST_TOKEN}}"
    output:
      format: json
  check:
    type: tool.shell
    command: sh -c 'echo "$ORK_RUN $ORK_NODE $ORK_ROUND $STATE $("$ORK_BIN" --version)"; printf "{\\"n\\":1}" > "$ORK_OUTPUT"'
    env:
      STATE: "{{nodes.pr.output.json.state}}"
    output:
      format: json
edges:
  - { from: pr, to: check, when: "json.state == 'OPEN'" }
`;

const ork = (
  place: { home: string; repo: string },
  args: readonly string[],
  env: Record<string, string> = {},
) =>
  spawnSync(process.execPath, [BIN, ...args], {
    cwd: place.repo,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: place.home,
      ORK_NO_UPDATE_CHECK: "1",
      ...env,
    },
  });

/** A run's events and folder, from the store under `home`. */
const onlyRun = (home: string) => {
  const store = openStore(storePath(home));
  const [run] = store.runs();
  const id = String(run?.id);
  const events = store.events(id).map(stored => stored.event);
  store.close();
  return { id, events };
};

const finishedOf = (events: readonly RunEvent[], node: string) =>
  events.find(event => event.type === "node.finished" && event.id === node);

describe("scripts in a real run", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const project = () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-script-")));
    dirs.push(root);
    const home = path.join(root, "home");
    const repo = path.join(root, "repo");
    mkdirSync(home);
    mkdirSync(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const file = path.join(repo, "scripted.ork.yaml");
    writeFileSync(file, WORKFLOW);
    return { home, repo, file };
  };

  it("passes identity and JSON along, and stores no secret", () => {
    const place = project();
    const done = ork(place, ["run", place.file], {
      ORK_TEST_TOKEN: SECRET,
      // As if a program in another run had started this one.
      ORK_RUN: "outer-run",
      ORK_OUTPUT: path.join(place.repo, "outer-output.json"),
    });
    expect(done.stderr).toBe("");
    expect(done.status).toBe(0);
    const { id, events } = onlyRun(place.home);
    const finished = (node: string) => finishedOf(events, node);
    expect(finished("pr")).toMatchObject({
      output: { json: { state: "OPEN", token: "[masked]" } },
    });
    expect(finished("check")).toMatchObject({
      ok: true,
      output: { json: { n: 1 } },
    });
    expect(JSON.stringify(finished("check"))).toContain(`${id} check 1 OPEN `);
    expect(existsSync(path.join(place.repo, "outer-output.json"))).toBe(false);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    const runDir = path.join(place.repo, ".ork", "runs", id);
    const files = readdirSync(runDir).map(name =>
      readFileSync(path.join(runDir, name), "utf8"),
    );
    expect(files.join("\n")).not.toContain(SECRET);
  });

  it("does not start when a variable it reads is not set", () => {
    const place = project();
    const done = ork(place, ["run", place.file]);
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("ORK_TEST_TOKEN, for pr");
  });

  it("tells a program the run's real folder from a subfolder", () => {
    const place = project();
    const sub = path.join(place.repo, "sub");
    mkdirSync(sub);
    const file = path.join(place.repo, "where.ork.yaml");
    writeFileSync(
      file,
      `schemaVersion: 1
name: where
nodes:
  n:
    type: tool.shell
    command: sh -c 'mkdir -p "$ORK_RUN_DIR" && test "$ORK_RUN_DIR" = "${place.repo}/.ork/runs/$ORK_RUN" && printf "{}" > "$ORK_OUTPUT"'
    output: { format: json }
`,
    );
    const done = spawnSync(process.execPath, [BIN, "run", file], {
      cwd: sub,
      encoding: "utf8",
      env: { ...process.env, HOME: place.home },
    });
    expect(done.stderr).toBe("");
    expect(done.status).toBe(0);
    expect(existsSync(path.join(sub, ".ork"))).toBe(false);
  });

  it("leaves no unread result behind when a run ends", () => {
    const place = project();
    const done = ork(place, ["run", place.file], { ORK_TEST_TOKEN: SECRET });
    expect(done.status).toBe(0);
    const { id } = onlyRun(place.home);
    const runDir = path.join(place.repo, ".ork", "runs", id);
    expect(existsSync(path.join(runDir, ".output"))).toBe(false);
  });

  it("warns of a variable a called workflow reads, and fails if it gets there", () => {
    const place = project();
    const dir = path.join(place.repo, ".ork", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "child.ork.yaml"),
      `schemaVersion: 1
name: child
nodes:
  deploy:
    type: tool.shell
    command: prog
    env: { T: "{{env.ORK_TEST_CHILD}}" }
`,
    );
    const side = path.join(place.repo, "side.txt");
    const file = path.join(place.repo, "parent.ork.yaml");
    writeFileSync(
      file,
      `schemaVersion: 1
name: parent
nodes:
  first: { type: tool.shell, command: touch ${side} }
  call: { type: workflow.call, workflow: child }
edges:
  - first -> call
`,
    );
    const done = ork(place, ["run", file]);
    expect(done.stderr).toContain("ORK_TEST_CHILD, for child/deploy");
    expect(done.status).toBe(1);
    expect(existsSync(side)).toBe(true);
  });

  it("is not stopped by a called workflow on a branch not taken", () => {
    const place = project();
    const dir = path.join(place.repo, ".ork", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "child.ork.yaml"),
      `schemaVersion: 1
name: child
nodes:
  deploy:
    type: tool.shell
    command: prog
    env: { T: "{{env.ORK_TEST_CHILD}}" }
`,
    );
    const file = path.join(place.repo, "branch.ork.yaml");
    writeFileSync(
      file,
      `schemaVersion: 1
name: branch
nodes:
  first: { type: tool.shell, command: "true" }
  call: { type: workflow.call, workflow: child }
edges:
  - { from: first, to: call, when: "exitCode == 1" }
`,
    );
    const done = ork(place, ["run", file]);
    expect(done.status).toBe(0);
    expect(done.stderr).toContain("That call fails if the run reaches it.");
  });

  it("masks in a called run what only its caller reads", () => {
    const place = project();
    const dir = path.join(place.repo, ".ork", "workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "child.ork.yaml"),
      `schemaVersion: 1
name: child
nodes:
  print: { type: tool.shell, command: printenv ORK_TEST_TOKEN }
`,
    );
    const file = path.join(place.repo, "caller.ork.yaml");
    writeFileSync(
      file,
      `schemaVersion: 1
name: caller
nodes:
  read:
    type: tool.shell
    command: "true"
    env: { T: "{{env.ORK_TEST_TOKEN}}" }
  call: { type: workflow.call, workflow: child }
edges:
  - read -> call
`,
    );
    const done = ork(place, ["run", file], { ORK_TEST_TOKEN: SECRET });
    expect(done.status).toBe(0);
    const store = openStore(storePath(place.home));
    const events = store.runs().flatMap(run => store.events(run.id));
    store.close();
    expect(JSON.stringify(events)).toContain("[masked]");
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("refuses `ork continue` from a program in a run", () => {
    const place = project();
    const done = ork(place, ["continue", "r1"], { ORK_RUN: "r1" });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("undoes a pause you set");
  });

  it("refuses to answer a decision from a program in a run", () => {
    const place = project();
    const done = ork(place, ["decide", "--id", "d1", "--choose", "yes"], {
      ORK_RUN: "r1",
    });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("answers as you");
    expect(done.stderr).toContain("ORK_RUN is set here");
  });

  it("still lists decisions for a program in a run", () => {
    const place = project();
    const done = ork(place, ["decide", "--list"], { ORK_SESSION: "1" });
    expect(done.status).toBe(0);
    expect(done.stdout).toContain("No open decisions.");
  });

  it("refuses `ork chat` from an agent's Bash", () => {
    const place = project();
    const done = ork(place, ["chat", "r1", "n", "-m", "hi"], {
      ORK_SESSION: "1",
    });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("speaks as you");
  });

  it("refuses `ork chat` from a program in a run", () => {
    const place = project();
    const done = ork(place, ["chat", "r1", "n", "-m", "hi"], { ORK_RUN: "r1" });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("speaks as you");
  });

  it("refuses `ork watch --accept` from a program in a run", () => {
    const place = project();
    const done = ork(place, ["watch", "--accept"], { ORK_RUN: "r1" });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("`ork watch --accept` approves code to run");
  });
});

describe("who may accept a trigger", () => {
  it.each(["ORK_RUN", "ORK_SESSION"])("isn't anyone under %s", marker => {
    const refused = acceptRefusal({ PATH: "/bin", [marker]: "1" });
    expect(refused).toContain("`ork watch --accept`");
    expect(refused).toContain(marker);
  });

  it("is someone with neither", () => {
    expect(acceptRefusal({ PATH: "/bin" })).toBeNull();
  });
});
