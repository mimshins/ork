/**
 * @file Tests for the server's guards (ADR-039): the loopback `Host`, the token
 *   from the cookie or a bearer header, the token's swap for the cookie, and
 *   the `Origin` and JSON checks on writes.
 */

import { describe, expect, it } from "vitest";

import {
  cookieName,
  guard,
  type GuardRequest,
  sameToken,
  sessionCookie,
} from "../src/index.ts";

const PORT = 4417;
const TOKEN = "t0ken-of-the-server";
const context = { port: PORT, token: TOKEN };
const HOST = `127.0.0.1:${String(PORT)}`;
const ORIGIN = `http://${HOST}`;

const request = (
  method: string,
  url: string,
  headers: GuardRequest["headers"],
): GuardRequest => ({ method, url, headers: { host: HOST, ...headers } });

const cookie = { cookie: `other=1; ${cookieName(PORT)}=${TOKEN}` };
const bearer = { authorization: `Bearer ${TOKEN}` };
const json = { "content-type": "application/json" };

const verdictOf = (
  method: string,
  url: string,
  headers: GuardRequest["headers"],
) => guard(request(method, url, headers), context);

describe("the guards", () => {
  it("refuses a Host that is not the server's loopback address", () => {
    expect(
      verdictOf("GET", "/api/runs", { ...bearer, host: "evil.test:4417" }),
    ).toMatchObject({ kind: "refuse", status: 403 });
    expect(
      verdictOf("GET", "/api/runs", { ...bearer, host: "127.0.0.1:9999" }),
    ).toMatchObject({ kind: "refuse", status: 403 });
    expect(
      verdictOf("GET", "/api/runs", {
        ...bearer,
        host: `localhost:${String(PORT)}`,
      }),
    ).toEqual({ kind: "pass" });
  });

  it("needs the token, from the cookie or a bearer header", () => {
    expect(verdictOf("GET", "/api/runs", {})).toMatchObject({
      kind: "refuse",
      status: 401,
    });
    expect(
      verdictOf("GET", "/api/runs", { authorization: "Bearer nope" }),
    ).toMatchObject({ kind: "refuse", status: 401 });
    expect(
      verdictOf("GET", "/api/runs", { cookie: `${cookieName(4418)}=${TOKEN}` }),
    ).toMatchObject({ kind: "refuse", status: 401 });
    expect(verdictOf("GET", "/api/runs", cookie)).toEqual({ kind: "pass" });
    expect(verdictOf("GET", "/api/runs", bearer)).toEqual({ kind: "pass" });
  });

  it("swaps the link's token for the session cookie, and drops it from the address", () => {
    expect(verdictOf("GET", `/runs?token=${TOKEN}&x=1`, {})).toEqual({
      kind: "exchange",
      cookie: sessionCookie(PORT, TOKEN),
      location: "/runs?x=1",
    });
    expect(sessionCookie(PORT, TOKEN)).toBe(
      `ork_ui_4417=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
    );
    expect(verdictOf("GET", "/?token=stale", {})).toMatchObject({
      kind: "refuse",
      status: 401,
    });
  });

  it("lets a write with the cookie in only from the server's own page", () => {
    expect(
      verdictOf("POST", "/api/runs/x/stop", { ...cookie, ...json }),
    ).toMatchObject({ kind: "refuse", status: 403 });
    expect(
      verdictOf("POST", "/api/runs/x/stop", {
        ...cookie,
        ...json,
        origin: "https://evil.test",
      }),
    ).toMatchObject({ kind: "refuse", status: 403 });
    expect(
      verdictOf("POST", "/api/runs/x/stop", {
        ...cookie,
        ...json,
        origin: ORIGIN,
      }),
    ).toEqual({ kind: "pass" });
  });

  it("lets a script with the bearer token write without an Origin, but not from a foreign one", () => {
    expect(
      verdictOf("POST", "/api/runs/x/stop", { ...bearer, ...json }),
    ).toEqual({ kind: "pass" });
    expect(
      verdictOf("POST", "/api/runs/x/stop", {
        ...bearer,
        ...json,
        origin: "https://evil.test",
      }),
    ).toMatchObject({ kind: "refuse", status: 403 });
  });

  it("needs a JSON body on a write", () => {
    expect(verdictOf("POST", "/api/runs/x/stop", { ...bearer })).toMatchObject({
      kind: "refuse",
      status: 415,
    });
    expect(
      verdictOf("POST", "/api/runs/x/stop", {
        ...bearer,
        "content-type": "text/plain",
      }),
    ).toMatchObject({ kind: "refuse", status: 415 });
    expect(
      verdictOf("POST", "/api/runs/x/stop", {
        ...bearer,
        "content-type": "application/json; charset=utf-8",
      }),
    ).toEqual({ kind: "pass" });
  });

  it("compares tokens in full", () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(sameToken("", TOKEN)).toBe(false);
  });
});
