/**
 * @file Tests for the server over HTTP: the guards on real requests, the link's
 *   token swapped for a cookie that then works, the page and its content
 *   security policy, `ui.json` while the server runs, and a port in use.
 */

import { afterEach, describe, expect, it } from "vitest";

import { readUiFile, startServer, uiFilePath } from "../src/index.ts";
import {
  rawGet,
  sessionOf,
  startTestServer,
  temp,
  type TestServer,
  text,
} from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

const serve = async (): Promise<TestServer> => {
  fixture = await startTestServer();
  return fixture;
};

describe("the server", () => {
  it("answers health with the token, and 401 without it", async () => {
    const { client, server } = await serve();
    const health = await client.call("health");
    expect(health).toMatchObject({
      ok: true,
      data: { version: "9.9.9", pid: process.pid },
    });
    const anonymous = await fetch(`${server.url}/api/health`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({
      error: "Not signed in; open the UI with `ork ui`.",
    });
  });

  it("refuses another Host with 403", async () => {
    const { server } = await serve();
    const answer = await rawGet(`${server.url}/api/health`, {
      host: "attacker.test",
      authorization: `Bearer ${server.token}`,
    });
    expect(answer.status).toBe(403);
  });

  it("swaps the link's token for a cookie, which then signs requests in", async () => {
    const { server } = await serve();
    const link = await fetch(`${server.url}/?token=${server.token}`, {
      redirect: "manual",
    });
    expect(link.status).toBe(302);
    expect(link.headers.get("location")).toBe("/");
    expect(link.headers.getSetCookie()[0]).toContain(
      "HttpOnly; SameSite=Strict",
    );
    const session = sessionOf(link);
    expect(
      (
        await fetch(`${server.url}/api/health`, {
          headers: { cookie: session },
        })
      ).status,
    ).toBe(200);
    const write = await fetch(`${server.url}/api/runs/x/stop`, {
      method: "POST",
      headers: { cookie: session, "content-type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(403);
  });

  it("serves the page under a strict content security policy", async () => {
    const { get } = await serve();
    const page = await get("/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(await page.text()).toContain('<script src="/placeholder.js">');
    expect(
      (await get("/placeholder.js")).headers.get("content-type"),
    ).toContain("javascript");
    expect((await get("/nothing")).status).toBe(404);
    expect((await get("/api/nothing")).status).toBe(404);
  });

  it("records itself in ui.json while it runs", async () => {
    const { home, server, close } = await serve();
    expect(readUiFile(uiFilePath(home))).toEqual({
      port: server.port,
      pid: process.pid,
      token: server.token,
      startedAt: text(),
    });
    await close();
    fixture = undefined;
    expect(readUiFile(uiFilePath(home))).toBeNull();
  });

  it("says when its port is in use", async () => {
    const { server } = await serve();
    await expect(
      startServer({
        version: "x",
        port: server.port,
        home: temp("ork-srv-home-"),
        record: false,
      }),
    ).rejects.toThrow(
      `Port ${String(server.port)} is in use; start Ork's UI on another with \`--port <n>\`.`,
    );
  });
});
