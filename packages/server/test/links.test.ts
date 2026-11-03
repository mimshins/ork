/**
 * @file Tests for the API's links: making one between live runs, listing it and
 *   ending it, and each refusal in the CLI's words.
 */

import { afterEach, describe, expect, it } from "vitest";

import { liveRun, startTestServer, type TestServer } from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const twoLiveRuns = async () => {
  fixture = await startTestServer();
  liveRun(fixture, "aaaa1111");
  liveRun(fixture, "bbbb2222");
  return fixture;
};

const body = { a: "aaaa1111/lead", b: "bbbb2222/lead" };

const endedLinks = async (client: TestServer["client"]) => {
  const listed = await client.call("links", {});
  return listed.ok ? listed.data : [];
};

describe("links", () => {
  it("links two running nodes, lists it, and ends it", async () => {
    const { client } = await twoLiveRuns();
    expect(await client.call("link", { body })).toMatchObject({
      ok: true,
      data: { a: { run: "aaaa1111", node: "lead" }, maxMessages: 100 },
    });
    expect(await client.call("links", {})).toMatchObject({
      ok: true,
      data: [{ b: { run: "bbbb2222", node: "lead" } }],
    });
    expect(await client.call("unlink", { body })).toEqual({
      ok: true,
      status: 200,
      data: { ended: true },
    });
    const [ended] = await endedLinks(client);
    expect(ended?.endedAt).toBeDefined();
  });

  it("takes a limit, and lists one run's", async () => {
    const { client } = await twoLiveRuns();
    await client.call("link", { body: { ...body, maxMessages: 5 } });
    expect(
      await client.call("links", { query: { run: "aaaa1111" } }),
    ).toMatchObject({ data: [{ maxMessages: 5 }] });
    expect(
      await client.call("links", { query: { run: "cccc3333" } }),
    ).toMatchObject({ data: [] });
  });

  it("refuses a node that is not there", async () => {
    const { client } = await twoLiveRuns();
    expect(
      await client.call("link", { body: { ...body, b: "bbbb2222/ghost" } }),
    ).toMatchObject({
      ok: false,
      status: 409,
      error: "ghost is not a node of run bbbb2222.",
    });
  });

  it("says when there is no link to end", async () => {
    const { client } = await twoLiveRuns();
    expect(await client.call("unlink", { body })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
