/**
 * @file Tests for `ork follow-ups` run through its real command against a store
 *   in a throwaway home: adding (and refusing a malformed one), the list
 *   grouped by due and `for`, a draft and steps shown to copy, done, drop,
 *   reopen and due, a github-channel message posted only with `--post
 *   --confirm` through a fake `gh`, `published` inside a run, and a `gh` that
 *   fails only warning.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { type FollowUp, openStore, storePath } from "@krapht/ork-core";
import { runCommand } from "citty";
import { afterEach, describe, expect, it, vi } from "vitest";

import { followUps } from "../src/commands/follow-ups.ts";

/** A `gh` that knows one merged pull request and takes comments. */
const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$HOME/gh.log"
case "$1 $2" in
  "pr view") echo '{"state":"MERGED"}' ;;
  "pr comment") echo https://github.com/acme/app/pull/7#issuecomment-1 ;;
  *) exit 1 ;;
esac
`;

/** A `gh` that is not signed in. */
const BROKEN_GH = `#!/bin/sh
echo "gh: not logged in" >&2
exit 1
`;

type Setup = { home: string; project: string };

const setup = (gh: string = FAKE_GH): Setup => {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fu-home-")));
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), "ork-fu-app-")));
  mkdirSync(path.join(project, ".ork"));
  mkdirSync(path.join(home, "bin"));
  const bin = path.join(home, "bin", "gh");
  writeFileSync(bin, gh);
  chmodSync(bin, 0o755);
  vi.stubEnv("HOME", home);
  vi.stubEnv("ORK_PLAIN", "1");
  vi.stubEnv("PATH", `${path.join(home, "bin")}:${process.env["PATH"] ?? ""}`);
  vi.stubEnv("ORK_RUN", "");
  const store = openStore(storePath(home));
  store.addProject({
    id: "app",
    root: project,
    mode: "in-repo",
    dir: path.join(project, ".ork"),
  });
  store.close();
  return { home, project };
};

type Ran = { out: string; err: string; code: number };

/** Runs `ork follow-ups <args>` as given and what it printed. */
const orkRaw = async (...args: string[]): Promise<Ran> => {
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
    await runCommand(followUps, { rawArgs: args });
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
  const code = exitCodeNow();
  process.exitCode = undefined;
  return { out, err, code };
};

/** Runs `ork follow-ups <args> --project app`. */
const ork = (...args: string[]): Promise<Ran> =>
  orkRaw(...args, "--project", "app");

const kept = (s: Setup): FollowUp[] => {
  const store = openStore(storePath(s.home));
  try {
    return store.followUps(s.project);
  } finally {
    store.close();
  }
};

const exitCodeNow = (): number =>
  process.exitCode === undefined ? 0 : Number(process.exitCode);

/** A matcher for text that contains `part`, typed so it may sit in an object. */
const containing = (part: string): unknown => expect.stringContaining(part);

const idAt = (s: Setup, index: number): string => kept(s)[index]?.id ?? "";

const first = (s: Setup): FollowUp => {
  const [one] = kept(s);
  if (one === undefined) throw new Error("no follow-up kept");
  return one;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ork follow-ups add", () => {
  it("adds a task for the maintainer, due now, with steps it never runs", async () => {
    const s = setup();
    const added = await ork(
      "add",
      "Run the migration",
      "--for",
      "me",
      "--step",
      "Back up first",
      "--step",
      "Migrate :: ./migrate.sh --prod",
    );
    expect(added.code).toBe(0);
    expect(added.out).toContain("added");
    expect(first(s)).toMatchObject({
      title: "Run the migration",
      for: "me",
      kind: "task",
      due: "now",
      status: "due",
      steps: [
        { text: "Back up first" },
        { text: "Migrate", command: "./migrate.sh --prod" },
      ],
    });
  });

  it("drafts a message to a person from --text, and defaults the kind to message", async () => {
    const s = setup();
    await ork(
      "add",
      "Tell Dana the API moved",
      "--for",
      "person:Dana",
      "--text",
      "The API moved to v2.",
      "--channel",
      "slack",
      "--due",
      "after-merge",
    );
    expect(first(s)).toMatchObject({
      kind: "message",
      status: "waiting",
      draft: { to: "Dana", channel: "slack", text: "The API moved to v2." },
    });
  });

  it("merges a near-duplicate into the one already kept", async () => {
    const s = setup();
    await ork("add", "Add retries to the client", "--for", "agent");
    const again = await ork(
      "add",
      "Add retries to the client",
      "--for",
      "agent",
    );
    expect(again.out).toContain("merged into");
    expect(kept(s)).toHaveLength(1);
  });

  it.each([
    [["add", "Tell Dana", "--for", "person:Dana"], "a message needs --text"],
    [
      ["add", "x", "--for", "person:a", "--text", "Hi", "--channel", "github"],
      "--channel github needs --to",
    ],
    [
      "add x --for person:a --text Hi --channel github --to #142".split(" "),
      "--channel github needs --to",
    ],
    [["add", "x", "--step", " :: "], "each step needs its text"],
    [["add", "x", "--for", "somebody"], "--for is agent, me"],
    [["add", "x", "--due", "someday"], "--due is now, after-merge"],
    [["add", "x", "--kind", "chore"], "--kind is change, message"],
    [["add", "x", "--for", "project:ghost"], "no registered project"],
  ] as const)("refuses %j", async (args, why) => {
    const s = setup();
    const ran = await ork(...args);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain(why);
    expect(kept(s)).toEqual([]);
  });
});

describe("ork follow-ups list and show", () => {
  it("lists due first, then waiting, each under who it is for", async () => {
    setup();
    await ork("add", "Check the dashboards", "--for", "me", "--kind", "check");
    await ork("add", "Add retries", "--for", "agent", "--due", "after-merge");
    await ork("add", "Ask Dana", "--for", "person:Dana", "--text", "Hi");
    const listed = await ork("list");
    const lines = listed.out.split("\n").map(line => line.trim());
    expect(lines.indexOf("Due (2)")).toBeLessThan(lines.indexOf("Waiting (1)"));
    expect(lines).toEqual(
      expect.arrayContaining(["for me", "for person:Dana", "for agent"]),
    );
    expect(listed.out).toContain("Check the dashboards");
    expect(listed.out).not.toContain("Done");
  });

  it("says when there is nothing, and prints JSON", async () => {
    setup();
    expect((await ork("list")).out).toContain("No follow-ups.");
    await ork("add", "Check it", "--for", "me");
    const json = await ork("list", "--json");
    expect(JSON.parse(json.out)).toMatchObject([{ title: "Check it" }]);
  });

  it("filters by --for", async () => {
    setup();
    await ork("add", "Mine", "--for", "me");
    await ork("add", "Theirs", "--for", "agent");
    const listed = await ork("list", "--for", "agent");
    expect(listed.out).toContain("Theirs");
    expect(listed.out).not.toContain("Mine");
  });

  it("filters by --status, --kind and --due, and --status all shows closed ones", async () => {
    const s = setup();
    await ork("add", "Mine", "--for", "me", "--kind", "check");
    await ork("add", "Theirs", "--for", "agent", "--due", "after-merge");
    await ork("drop", idAt(s, 0));
    expect((await ork("list")).out).not.toContain("Mine");
    expect((await ork("list", "--status", "all")).out).toContain("Dropped (1)");
    const dropped = await ork("list", "--status", "dropped");
    expect(dropped.out).toContain("Mine");
    expect(dropped.out).not.toContain("Theirs");
    const waiting = await ork(
      "list",
      "--status",
      "waiting",
      "--kind",
      "change",
    );
    expect(waiting.out).toContain("Theirs");
    expect((await ork("list", "--kind", "check")).out).toContain(
      "No follow-ups.",
    );
    expect((await ork("list", "--due", "after-merge")).out).toContain("Theirs");
    expect((await ork("list", "--due", "now")).out).toContain("No follow-ups.");
  });

  it("orders due first, then cuts with --limit, and prints --ids on one line", async () => {
    const s = setup();
    await ork("add", "Later", "--for", "agent", "--due", "after-merge");
    await ork("add", "Now", "--for", "me");
    await ork("add", "Now too", "--for", "me");
    const [later, now, nowToo] = [idAt(s, 0), idAt(s, 1), idAt(s, 2)];
    const ids = await ork("list", "--ids");
    expect(ids.out.trim()).toBe(`${now},${nowToo},${later}`);
    const one = await ork("list", "--ids", "--limit", "1");
    expect(one.out.trim()).toBe(now);
    expect(
      JSON.parse((await ork("list", "--json", "--limit", "2")).out),
    ).toHaveLength(2);
    expect((await ork("list", "--ids", "--for", "person:nobody")).out).toBe("");
  });

  it("checks `--for project:<name>` against the registered projects", async () => {
    setup();
    await ork("add", "For me", "--for", "me");
    const bad = await ork("list", "--for", "project:nope");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("No registered project `nope`; registered: app.");
    expect(bad.out).toBe("");
    for (const value of ["project:app", "agent", "me", "person:anyone"]) {
      // oxlint-disable-next-line no-await-in-loop -- one list at a time
      expect((await ork("list", "--for", value)).code).toBe(0);
    }
  });

  it("--ids and --json order rows as the human list does: status, then who it is for", async () => {
    const s = setup();
    await ork("add", "For Dana", "--for", "person:Dana", "--text", "Hi");
    await ork("add", "For me", "--for", "me");
    await ork("add", "For agent", "--for", "agent");
    const [dana, me, agent] = [idAt(s, 0), idAt(s, 1), idAt(s, 2)];
    expect((await ork("list", "--ids")).out.trim()).toBe(
      `${agent},${me},${dana}`,
    );
    expect((await ork("list", "--ids", "--limit", "1")).out.trim()).toBe(agent);
    expect(JSON.parse((await ork("list", "--json")).out)).toMatchObject([
      { title: "For agent" },
      { title: "For me" },
      { title: "For Dana" },
    ]);
  });

  it("does not cap --ids: only ps has a default limit", async () => {
    setup();
    for (let n = 0; n < 25; n += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one add at a time
      await ork("add", `Check ${String(n)}`, "--for", "me");
    }
    expect((await ork("list", "--ids")).out.trim().split(",")).toHaveLength(25);
  });

  it.each(["0", "-1", "abc", "2.5"])("refuses --limit %s", async limit => {
    setup();
    const bad = await ork("list", "--limit", limit);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--limit takes a positive whole number");
  });

  it("refuses a bad value, and --ids with --json", async () => {
    setup();
    // citty refuses an enum value itself, naming the flag and the choices.
    await expect(ork("list", "--kind", "chore")).rejects.toThrow(
      "--kind (chore). Expected one of: change, message, task, check",
    );
    expect((await ork("list", "--for", "somebody")).code).toBe(1);
    const both = await ork("list", "--ids", "--json");
    expect(both.code).toBe(1);
    expect(both.err).toContain("--ids and --json can't be used together");
    const ghost = await orkRaw("list", "--project", "ghost");
    expect(ghost.code).toBe(1);
    expect(ghost.err).toContain("registered: app");
  });

  it("takes --project all with --status all", async () => {
    const s = setup();
    await ork("add", "Mine", "--for", "me");
    await ork("drop", idAt(s, 0));
    const all = await orkRaw("list", "--project", "all", "--status", "all");
    expect(all.out).toContain("Dropped (1)");
  });

  it("shows a draft and steps whole, to copy", async () => {
    const s = setup();
    await ork(
      "add",
      "Cut over",
      "--for",
      "me",
      "--step",
      "Switch traffic :: kubectl rollout restart deploy/app",
    );
    await ork(
      "add",
      "Tell Dana",
      "--for",
      "person:Dana",
      "--text",
      "Line one\nLine two",
      "--channel",
      "email",
    );
    const steps = await ork("show", idAt(s, 0));
    expect(steps.out).toContain("Steps (Ork never runs them):");
    expect(steps.out).toContain("     kubectl rollout restart deploy/app");
    const shown = await ork("show", idAt(s, 1).slice(0, 3));
    expect(shown.out).toContain("Draft to Dana (email)");
    expect(shown.out).toContain("  Line one");
    expect(shown.out).toContain("  Line two");
  });

  it("refuses an id it does not know", async () => {
    setup();
    const ran = await ork("show", "nope");
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("No follow-up `nope`");
  });
});

describe("closing follow-ups", () => {
  it("marks done, drops and reopens, and says why one can't", async () => {
    const s = setup();
    await ork("add", "Check it", "--for", "me", "--kind", "check");
    const { id } = first(s);
    expect((await ork("done", id)).out).toContain("done");
    expect(first(s).status).toBe("done");
    const again = await ork("done", id);
    expect(again.code).toBe(1);
    expect(again.err).toContain("is done");
    expect((await ork("reopen", id)).code).toBe(0);
    expect(first(s).status).toBe("due");
    expect((await ork("drop", id)).code).toBe(0);
    expect(first(s).status).toBe("dropped");
    expect((await ork("list")).out).toContain("No follow-ups.");
    expect((await ork("list", "--status", "all")).out).toContain("Dropped (1)");
  });

  it("makes a waiting follow-up due by id, and all of a run's by run id", async () => {
    const s = setup();
    await ork(
      "add",
      "Check after deploy",
      "--for",
      "me",
      "--due",
      "after-deploy",
    );
    const { id } = first(s);
    expect((await ork("due", id)).out).toContain("due");
    expect(first(s).status).toBe("due");
    expect((await ork("due", id)).code).toBe(1);
    expect((await ork("due", "nothing")).err).toContain("Nothing waiting");
  });
});

/** Adds a message drafted for a GitHub PR, and gives its id. */
const draft = async (s: Setup): Promise<string> => {
  await ork(
    "add",
    "Reply on the PR",
    "--for",
    "person:partner",
    "--to",
    "https://github.com/acme/app/pull/7",
    "--channel",
    "github",
    "--text",
    "The API moved.",
  );
  return first(s).id;
};

const ghLog = (s: Setup): string => {
  try {
    return readFileSync(path.join(s.home, "gh.log"), "utf8");
  } catch {
    return "";
  }
};

describe("a message on the github channel", () => {
  it("posts nothing without --confirm, and shows the text it would post", async () => {
    const s = setup();
    const id = await draft(s);
    const ran = await ork("post", id);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain(
      "Would post to https://github.com/acme/app/pull/7",
    );
    expect(ran.err).toContain("--confirm");
    expect(ghLog(s)).not.toContain("comment");
    expect(first(s).status).toBe("due");
  });

  it("posts through gh with --confirm, and is then done", async () => {
    const s = setup();
    const id = await draft(s);
    const ran = await ork("post", id, "--confirm");
    expect(ran.code).toBe(0);
    expect(ran.out).toContain(
      "posted https://github.com/acme/app/pull/7#issuecomment-1",
    );
    expect(ghLog(s)).toContain(
      "gh pr comment https://github.com/acme/app/pull/7 --body The API moved.",
    );
    expect(first(s).status).toBe("done");
  });

  it("refuses a post of another channel", async () => {
    const s = setup();
    await ork("add", "Tell Dana", "--for", "person:Dana", "--text", "Hi");
    const { id } = first(s);
    const slack = await ork("post", id, "--confirm");
    expect(slack.code).toBe(1);
    expect(slack.err).toContain(
      "only a message drafted for the github channel",
    );
  });

  it("refuses a post of a message already done, posting nothing", async () => {
    const s = setup();
    const id = await draft(s);
    await ork("done", id);
    const ran = await ork("post", id, "--confirm");
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("is done, so it is not posted");
    expect(ghLog(s)).not.toContain("comment");
  });
});

describe("what is due", () => {
  it("moves an after-merge follow-up to due when gh shows its PR merged", async () => {
    const s = setup();
    await ork(
      "add",
      "Add retries",
      "--for",
      "agent",
      "--due",
      "after-merge",
      "--ref",
      "https://github.com/acme/app/pull/7",
    );
    expect(first(s).status).toBe("waiting");
    const listed = await ork("list");
    expect(listed.out).toContain("Due (1)");
    expect(first(s)).toMatchObject({
      status: "due",
      note: containing("merged"),
    });
  });

  it("only warns when gh fails, and leaves it waiting", async () => {
    const s = setup(BROKEN_GH);
    await ork(
      "add",
      "Add retries",
      "--for",
      "agent",
      "--due",
      "after-merge",
      "--ref",
      "feature",
    );
    const listed = await ork("list");
    expect(listed.code).toBe(0);
    expect(listed.err.trim().split("\n")).toEqual([
      "Can't check PRs: `gh` isn't signed in. After-merge follow-ups stay waiting; run `gh auth login` yourself.",
    ]);
    expect(listed.out).toContain("Waiting (1)");
    expect(first(s).status).toBe("waiting");
  });

  it("names the first error, in one line, when gh fails another way", async () => {
    setup(`#!/bin/sh\necho "gh: rate limited" >&2\nexit 1\n`);
    await ork(
      "add",
      "A",
      "--for",
      "agent",
      "--due",
      "after-merge",
      "--ref",
      "x",
    );
    await ork(
      "add",
      "B",
      "--for",
      "agent",
      "--due",
      "after-merge",
      "--ref",
      "y",
    );
    const listed = await ork("list");
    expect(listed.err.trim().split("\n")).toEqual([
      "Can't check PRs: gh failed: gh: rate limited. After-merge follow-ups stay waiting.",
    ]);
  });

  it("keeps a multi-line gh error to its first line, without its period", async () => {
    setup(
      `#!/bin/sh\nprintf 'gh: rate limited.\\nTry again later.\\n' >&2\nexit 1\n`,
    );
    await ork(
      "add",
      "A",
      "--for",
      "agent",
      "--due",
      "after-merge",
      "--ref",
      "x",
    );
    const listed = await ork("list");
    expect(listed.err.trim().split("\n")).toEqual([
      "Can't check PRs: gh failed: gh: rate limited. After-merge follow-ups stay waiting.",
    ]);
  });
});

describe("ork follow-ups published", () => {
  it("makes what a run left wait on its branch, inside the run", async () => {
    const s = setup(BROKEN_GH);
    const store = openStore(storePath(s.home));
    store.begin({
      id: "r1",
      workflow: "build",
      file: "b.ork.yaml",
      project: s.project,
    });
    store.close();
    await ork(
      "add",
      "Check after merge",
      "--for",
      "me",
      "--due",
      "after-merge",
    );
    const store2 = openStore(storePath(s.home));
    store2.putFollowUp({
      ...first(s),
      from: { run: "r1", node: "build" },
    });
    store2.close();
    vi.stubEnv("ORK_RUN", "r1");
    // The status of a waiting follow-up with no ref: ask for the ref's state later.
    const ran = await ork("published", "feature");
    expect(ran.out).toContain("1 follow-up(s) now wait on feature");
    expect(first(s).ref).toBe("feature");
  });

  it("finishes what the run that called it took", async () => {
    const s = setup(BROKEN_GH);
    const store = openStore(storePath(s.home));
    const run = { workflow: "w", file: "w.ork.yaml", project: s.project };
    store.begin({ ...run, id: "start1" });
    store.begin({ ...run, id: "build1", parent: "start1" });
    store.close();
    await ork("add", "Retry the client", "--for", "agent", "--due", "now");
    const store2 = openStore(storePath(s.home));
    store2.putFollowUp({ ...first(s), takenBy: "start1" });
    store2.close();
    vi.stubEnv("ORK_RUN", "build1");
    const ran = await ork("published", "feature");
    expect(ran.out).toContain("1 done");
    expect(first(s).status).toBe("done");
  });

  it("refuses outside a run", async () => {
    setup();
    const ran = await ork("published", "feature");
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("ORK_RUN is not set");
  });
});
