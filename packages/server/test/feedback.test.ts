/**
 * @file Tests for the feedback routes: a person's note on a run, or one node
 *   that ran in it, joins the run's feedback with the same checks as `ork
 *   feedback note`, and each refusal says why.
 */

import { afterEach, describe, expect, it } from "vitest";

import { liveRun, startTestServer, type TestServer } from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const withRun = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  liveRun(fixture, "run12345");
  return fixture;
};

const note = (
  server: TestServer,
  body: { text: string; node?: string; kind?: string; rating?: string },
  run = "run12345",
) => server.client.call("note", { params: { id: run }, body });

describe("noting a run's node", () => {
  it("records the note as the run's feedback, from a person", async () => {
    const server = await withRun();
    const noted = await note(server, {
      text: "Missed the failing test\nIt read only the summary.",
      node: "lead",
      rating: "bad",
    });
    const [item] = server.store.feedbackItems();
    expect(noted).toEqual({ ok: true, status: 200, data: { item: item?.id } });
    expect(item).toMatchObject({
      title: "Missed the failing test",
      severity: "high",
      sources: ["human"],
      workflows: ["demo"],
    });
    expect(
      server.store.feedbackRecords(String(item?.id)).map(r => r.node),
    ).toEqual(["lead"]);
  });

  it("refuses a node that didn't run, a kind it doesn't know, and no run", async () => {
    const server = await withRun();
    expect(await note(server, { text: "x", node: "check" })).toEqual({
      ok: false,
      status: 400,
      error: "No node check ran in run run12345.",
    });
    expect(await note(server, { text: "x", kind: "rant" })).toEqual({
      ok: false,
      status: 400,
      error: "kind is one of friction, bug, context-gap, skill, workflow, idea",
    });
    expect((await note(server, { text: "x" }, "nope")).status).toBe(404);
    expect(server.store.feedbackItems()).toEqual([]);
  });
});
