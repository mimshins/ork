/**
 * @file Tests for the workflow builder's routes (RFC-008): a draft holds
 *   unfinished work and never reaches the workflows folder, edits keep the
 *   file's comments, errors and a changed file block a save, and nothing is
 *   written outside the project's workflows folder.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CallResult } from "../src/index.ts";
import { startTestServer, temp, type TestServer } from "./fixtures.ts";

let fixture: TestServer;

beforeEach(async () => {
  fixture = await startTestServer();
});

afterEach(async () => {
  await fixture.close();
});

const fileIn = (name: string): string =>
  path.join(fixture.project.dir, "workflows", `${name}.ork.yaml`);

const VALID = `# Kept by the platform team.
schemaVersion: 1
name: real
nodes:
  # says hello
  hello:
    type: tool.shell
    command: echo hi # short
`;

/** Its last node can't run: the only edge to it is switched off. */
const STRANDED = `schemaVersion: 1
name: real
nodes:
  hello:
    type: tool.shell
    command: echo hi
  off:
    type: tool.shell
    command: echo off
edges:
  - { from: hello, to: off, when: "false" }
`;

const PARAMS = { id: "demo", name: "real" };

const waysIn = (walk: string | null): number =>
  Number(/Walked ([\d,]+)/u.exec(walk ?? "")?.[1]?.replaceAll(",", ""));

const answer = async <T>(call: Promise<CallResult<T>>) => {
  const result = await call;
  if (!result.ok) throw new Error(result.error);
  return result;
};

const refusal = async (
  call: Promise<{ ok: true } | { ok: false; status: number; error: string }>,
) => {
  const result = await call;
  if (result.ok) throw new Error("It was not refused.");
  return result;
};

const save = (name: string, force?: boolean) =>
  answer(
    fixture.client.call("builderSave", {
      params: { id: "demo", name },
      body: force === undefined ? {} : { force },
    }),
  );

const describeIt = (name: string) =>
  fixture.client.call("builderEdit", {
    params: { id: "demo", name },
    body: {
      edits: [{ op: "set", path: ["description"], value: "Saved." }],
    },
  });

const create = (name: string) =>
  refusal(
    fixture.client.call("builderCreate", {
      params: { id: "demo" },
      body: { name },
    }),
  );

describe("reading a workflow", () => {
  it("shows the file, its graph and what the checks say", async () => {
    writeFileSync(fileIn("real"), VALID);
    const view = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(view.data).toMatchObject({
      name: "real",
      text: VALID,
      draft: false,
      changedOnDisk: false,
      diagnostics: [],
    });
    expect(view.data.graph.nodes).toEqual([
      { id: "hello", type: "tool.shell" },
    ]);
  });

  it("answers 404 for a workflow or a project that isn't there", async () => {
    expect(
      (
        await refusal(
          fixture.client.call("builderView", {
            params: { id: "demo", name: "ghost" },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await refusal(
          fixture.client.call("builderView", {
            params: { id: "nobody", name: "real" },
          }),
        )
      ).status,
    ).toBe(404);
  });

  it.each(["..", ".hidden", "a%2Fb", "..%2F..%2Fescape"])(
    "refuses the name %s",
    async name => {
      const response = await fixture.get(`/api/projects/demo/builder/${name}`);
      expect([400, 404]).toContain(response.status);
    },
  );
});

describe("a draft", () => {
  it("starts from a slug, and never touches the workflows folder", async () => {
    const view = await answer(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "fresh" },
      }),
    );
    expect(view.data.draft).toBe(true);
    expect(view.data.graph.nodes).toEqual([]);
    expect(view.data.diagnostics.map(d => d.severity)).toContain("error");
    expect(existsSync(fileIn("fresh"))).toBe(false);
    const edited = await answer(
      fixture.client.call("builderEdit", {
        params: { id: "demo", name: "fresh" },
        body: {
          edits: [{ op: "addNode", id: "gate", node: { type: "human.gate" } }],
        },
      }),
    );
    expect(edited.data.graph.nodes).toEqual([
      { id: "gate", type: "human.gate" },
    ]);
    expect(existsSync(fileIn("fresh"))).toBe(false);
  });

  it("refuses a bad name, or one that's taken", async () => {
    writeFileSync(fileIn("real"), VALID);
    expect((await create("Not A Slug")).status).toBe(400);
    expect((await create("../escape")).status).toBe(400);
    expect((await create("real")).status).toBe(409);
  });

  it("keeps the file's comments, in the store and not the file", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: {
          edits: [
            {
              op: "set",
              path: ["nodes", "hello", "command"],
              value: "echo bye",
            },
          ],
        },
      }),
    );
    const stored = fixture.store.draft("demo", "real");
    expect(stored?.text).toContain("# Kept by the platform team.");
    expect(stored?.text).toContain("echo bye # short");
    expect(readFileSync(fileIn("real"), "utf8")).toBe(VALID);
  });

  it("refuses an edit it can't make, or that isn't an edit", async () => {
    writeFileSync(fileIn("real"), VALID);
    const missing = await refusal(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: { edits: [{ op: "removeNode", id: "ghost" }] },
      }),
    );
    expect(missing.status).toBe(409);
    const odd = await fetch(
      `${fixture.server.url}/api/projects/demo/builder/real/edits`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.server.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ edits: [{ op: "nonsense" }] }),
      },
    );
    expect(odd.status).toBe(400);
    expect(fixture.store.draft("demo", "real")).toBeUndefined();
  });

  it("goes away when edits lead back to the file, and on undo", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: {
          edits: [
            { op: "set", path: ["description"], value: "Now described." },
          ],
        },
      }),
    );
    expect(fixture.store.draft("demo", "real")).toBeDefined();
    const back = await answer(
      fixture.client.call("builderRestore", {
        params: PARAMS,
        body: { text: VALID, baseHash: null },
      }),
    );
    expect(back.data.draft).toBe(false);
    expect(fixture.store.draft("demo", "real")).toBeUndefined();
  });

  it("can be discarded, back to the file or to nothing", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: {
          edits: [{ op: "set", path: ["description"], value: "Changed." }],
        },
      }),
    );
    const back = await answer(
      fixture.client.call("builderDiscard", { params: PARAMS }),
    );
    expect(back.data).toMatchObject({ text: VALID, draft: false });
    await answer(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "fresh" },
      }),
    );
    const gone = await answer(
      fixture.client.call("builderDiscard", {
        params: { id: "demo", name: "fresh" },
      }),
    );
    expect(gone.data).toEqual({ gone: true });
  });
});

describe("a link in the workflows folder", () => {
  const SECRET = "AWS_SECRET=hunter2";

  it("isn't followed out of the project to read a file", async () => {
    const elsewhere = temp("ork-srv-outside-");
    const target = path.join(elsewhere, "secret.txt");
    writeFileSync(target, SECRET);
    symlinkSync(target, fileIn("leak"));
    const blocked = await refusal(
      fixture.client.call("builderView", {
        params: { id: "demo", name: "leak" },
      }),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.error).toContain("leads out");
    expect(blocked.error).not.toContain("hunter2");
  });

  it("isn't followed out of the project to take a file into a draft", async () => {
    const elsewhere = temp("ork-srv-outside-");
    const target = path.join(elsewhere, "real.ork.yaml");
    writeFileSync(target, VALID);
    symlinkSync(target, fileIn("real"));
    await refusal(describeIt("real"));
    expect(fixture.store.draft("demo", "real")).toBeUndefined();
  });

  it("isn't followed when the whole folder leads out", async () => {
    const elsewhere = temp("ork-srv-outside-");
    writeFileSync(path.join(elsewhere, "leak.ork.yaml"), SECRET);
    const folder = path.join(fixture.project.dir, "workflows");
    rmSync(folder, { recursive: true });
    symlinkSync(elsewhere, folder);
    const blocked = await refusal(
      fixture.client.call("builderView", {
        params: { id: "demo", name: "leak" },
      }),
    );
    expect(blocked.error).toContain("leads out");
  });

  it("is refused when it leads nowhere", async () => {
    const folder = path.join(fixture.project.dir, "workflows");
    rmSync(folder, { recursive: true });
    symlinkSync(path.join(fixture.project.dir, "gone"), folder);
    const blocked = await refusal(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(blocked.status).toBe(409);
  });
});

describe("saving", () => {
  it("writes the file with its comments, and clears the draft", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(describeIt("real"));
    const saved = await save("real");
    expect(saved.data).toEqual({ saved: true, file: fileIn("real") });
    const text = readFileSync(fileIn("real"), "utf8");
    expect(text).toContain("description: Saved.");
    expect(text).toContain("# Kept by the platform team.");
    expect(text).toContain("# says hello");
    expect(fixture.store.draft("demo", "real")).toBeUndefined();
  });

  it("is blocked by errors, keeping the draft and the file", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: {
          edits: [{ op: "connect", from: "hello", to: "ghost" }],
        },
      }),
    );
    const blocked = await save("real");
    expect(blocked.data).toMatchObject({ saved: false, why: "errors" });
    expect(readFileSync(fileIn("real"), "utf8")).toBe(VALID);
    expect(fixture.store.draft("demo", "real")).toBeDefined();
  });

  it("builds a new workflow from nothing to a saved file", async () => {
    await answer(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "fresh" },
      }),
    );
    await answer(
      fixture.client.call("builderEdit", {
        params: { id: "demo", name: "fresh" },
        body: {
          edits: [
            {
              op: "addNode",
              id: "hello",
              node: { type: "tool.shell", command: "echo hi" },
            },
          ],
        },
      }),
    );
    const saved = await save("fresh");
    expect(saved.data).toMatchObject({ saved: true });
    expect(readFileSync(fileIn("fresh"), "utf8")).toContain("command: echo hi");
  });

  it("is blocked when the file changed, until the user chooses", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(describeIt("real"));
    writeFileSync(fileIn("real"), `${VALID}# Someone else's line.\n`);
    const view = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(view.data.changedOnDisk).toBe(true);
    const blocked = await save("real");
    expect(blocked.data).toMatchObject({ saved: false, why: "changed" });
    expect(readFileSync(fileIn("real"), "utf8")).toContain("Someone else");
    const forced = await save("real", true);
    expect(forced.data).toMatchObject({ saved: true });
    expect(readFileSync(fileIn("real"), "utf8")).not.toContain("Someone else");
  });

  it("is blocked when a new workflow's file appeared meanwhile", async () => {
    await answer(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "fresh" },
      }),
    );
    await answer(
      fixture.client.call("builderEdit", {
        params: { id: "demo", name: "fresh" },
        body: {
          edits: [
            {
              op: "addNode",
              id: "hello",
              node: { type: "tool.shell", command: "echo hi" },
            },
          ],
        },
      }),
    );
    writeFileSync(fileIn("fresh"), VALID.replace("real", "fresh"));
    const blocked = await save("fresh");
    expect(blocked.data).toMatchObject({ saved: false, why: "changed" });
  });

  it("won't write through a link, even one that stays inside", async () => {
    const target = path.join(fixture.project.root, "real.ork.yaml");
    writeFileSync(target, VALID);
    symlinkSync(target, fileIn("real"));
    await answer(describeIt("real"));
    const blocked = await refusal(
      fixture.client.call("builderSave", { params: PARAMS, body: {} }),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.error).toContain("symbolic link");
    expect(readFileSync(target, "utf8")).toBe(VALID);
  });

  it("won't write when .ork itself leads out of the repository", async () => {
    const elsewhere = temp("ork-srv-outside-");
    const { dir } = fixture.project;
    rmSync(dir, { recursive: true });
    mkdirSync(path.join(elsewhere, "workflows"), { recursive: true });
    symlinkSync(elsewhere, dir);
    const blocked = await refusal(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "esc" },
      }),
    );
    expect(blocked.error).toContain("leads out");
    expect(existsSync(path.join(elsewhere, "workflows", "esc.ork.yaml"))).toBe(
      false,
    );
  });

  it("refuses a folder with a workflow's name, rather than failing", async () => {
    mkdirSync(fileIn("real"));
    const blocked = await refusal(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.error).toContain("isn't a file");
  });

  it("shows what walking it found, with its line", async () => {
    writeFileSync(fileIn("real"), STRANDED);
    const { data } = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(data.walk).toBe(
      "Walked 2 ways through: 1 end succeeded, 1 end failed (every way a node can fail is one).",
    );
    expect(data.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "walk.never-runs",
        severity: "warning",
        path: ["nodes", "off"],
        line: 8,
      }),
    );
  });

  it("walks again as an edit changes it", async () => {
    writeFileSync(fileIn("real"), VALID);
    const before = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(before.data.walk).toContain("Walked 2 ways");
    const after = await answer(
      fixture.client.call("builderEdit", {
        params: PARAMS,
        body: {
          edits: [
            {
              op: "set",
              path: ["nodes", "ask"],
              value: {
                type: "human.gate",
                question: "Go?",
                options: ["go", "keep"],
              },
            },
          ],
        },
      }),
    );
    expect(after.data.walk).toContain("Walked 4 ways");
  });

  it("keeps an edit's walk short on a wide workflow", async () => {
    const wide = Array.from(
      { length: 300 },
      (_, at) => `  n${String(at)}: { type: tool.shell, command: "true" }`,
    );
    writeFileSync(
      fileIn("real"),
      ["schemaVersion: 1", "name: real", "nodes:", ...wide, ""].join("\n"),
    );
    const { data } = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(data.walk).toContain("and stopped");
    // In a second, the limit elsewhere, it gets about 100 ways through this.
    expect(waysIn(data.walk)).toBeLessThan(70);
  });

  it("doesn't walk what has errors", async () => {
    writeFileSync(fileIn("real"), "schemaVersion: 1\nname: real\nnodes: {}\n");
    const { data } = await answer(
      fixture.client.call("builderView", { params: PARAMS }),
    );
    expect(data.walk).toBeNull();
  });

  it("saves over what walking it found: a warning never blocks", async () => {
    writeFileSync(fileIn("real"), VALID);
    await answer(
      fixture.client.call("builderRestore", {
        params: PARAMS,
        body: { text: STRANDED, baseHash: null },
      }),
    );
    const saved = await answer(
      fixture.client.call("builderSave", {
        params: PARAMS,
        body: { force: true },
      }),
    );
    expect(saved.data.saved).toBe(true);
    expect(readFileSync(fileIn("real"), "utf8")).toBe(STRANDED);
  });

  it("refuses a name too long to be a file", async () => {
    const blocked = await refusal(
      fixture.client.call("builderView", {
        params: { id: "demo", name: "a".repeat(300) },
      }),
    );
    expect(blocked.status).toBe(400);
  });

  it("asks before undo puts back what a file changed from", async () => {
    writeFileSync(fileIn("real"), VALID);
    const first = await answer(describeIt("real"));
    await answer(
      fixture.client.call("builderSave", { params: PARAMS, body: {} }),
    );
    const newer = VALID.replace("# Kept", "# Changed elsewhere, kept");
    writeFileSync(fileIn("real"), newer);
    const { previous } = first.data;
    await answer(
      fixture.client.call("builderRestore", {
        params: PARAMS,
        body: previous,
      }),
    );
    const saved = await answer(
      fixture.client.call("builderSave", { params: PARAMS, body: {} }),
    );
    expect(saved.data.saved).toBe(false);
    expect(readFileSync(fileIn("real"), "utf8")).toBe(newer);
  });

  it("undoes to what an edit really started from", async () => {
    writeFileSync(fileIn("real"), VALID);
    const newer = VALID.replace("# Kept", "# Changed elsewhere, kept");
    writeFileSync(fileIn("real"), newer);
    const { previous } = (await answer(describeIt("real"))).data;
    expect(previous.text).toBe(newer);
    const back = await answer(
      fixture.client.call("builderRestore", {
        params: PARAMS,
        body: previous,
      }),
    );
    expect(back.data.draft).toBe(false);
  });

  it("keeps a new workflow's blank base when an edit follows", async () => {
    await answer(
      fixture.client.call("builderCreate", {
        params: { id: "demo" },
        body: { name: "fresh" },
      }),
    );
    writeFileSync(fileIn("fresh"), VALID);
    await answer(describeIt("fresh"));
    expect(fixture.store.draft("demo", "fresh")?.baseHash).toBeNull();
  });

  it("requires the token, as every write does", async () => {
    const response = await fetch(
      `${fixture.server.url}/api/projects/demo/builder/real/save`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(401);
  });
});
