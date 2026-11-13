/**
 * @file Tests for the server's guards (ADR-039, RFC-019): the loopback `Host`,
 *   the token from a bearer header and the session secret from the cookie
 *   (never the other way round), a sign-in code's single-use, 60-second swap
 *   for the cookie, and the `Origin` and JSON checks on writes.
 */

import { describe, expect, it } from "vitest";

import {
  CODE_LIFETIME_SECONDS,
  cookieName,
  createSignInCodes,
  guard,
  type GuardRequest,
  sameToken,
  sessionCookie,
} from "../src/index.ts";

const PORT = 4417;
const TOKEN = "t0ken-of-the-server";
const SESSION = "session-secret-of-the-page";
const HOST = `127.0.0.1:${String(PORT)}`;
const ORIGIN = `http://${HOST}`;
const BAD_CODE = {
  kind: "refuse",
  status: 401,
  error:
    "That sign-in link is not valid any more; open it again with `ork ui`.",
};

const PASS_BEARER = { kind: "pass", via: "bearer" };
const PASS_COOKIE = { kind: "pass", via: "cookie" };

const request = (
  method: string,
  url: string,
  headers: GuardRequest["headers"],
): GuardRequest => ({ method, url, headers: { host: HOST, ...headers } });

const cookie = { cookie: `other=1; ${cookieName(PORT)}=${SESSION}` };
const bearer = { authorization: `Bearer ${TOKEN}` };
const json = { "content-type": "application/json" };

/** A context with its own code store and a clock a test can move. */
const setup = () => {
  const clock = { now: 1_000_000 };
  const codes = createSignInCodes(() => clock.now);
  const context = { port: PORT, token: TOKEN, session: SESSION, codes };
  return {
    clock,
    codes,
    verdictOf: (
      method: string,
      url: string,
      headers: GuardRequest["headers"],
    ) => guard(request(method, url, headers), context),
  };
};

const { verdictOf } = setup();

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
    ).toEqual(PASS_BEARER);
  });

  it("needs the token as a bearer, or the session secret as the cookie", () => {
    expect(verdictOf("GET", "/api/runs", {})).toMatchObject({
      kind: "refuse",
      status: 401,
    });
    expect(
      verdictOf("GET", "/api/runs", { authorization: "Bearer nope" }),
    ).toMatchObject({ kind: "refuse", status: 401 });
    expect(
      verdictOf("GET", "/api/runs", {
        cookie: `${cookieName(4418)}=${SESSION}`,
      }),
    ).toMatchObject({ kind: "refuse", status: 401 });
    expect(verdictOf("GET", "/api/runs", cookie)).toEqual(PASS_COOKIE);
    expect(verdictOf("GET", "/api/runs", bearer)).toEqual(PASS_BEARER);
  });

  it("refuses the token in the cookie and the session secret as a bearer", () => {
    expect(
      verdictOf("GET", "/api/runs", {
        cookie: `${cookieName(PORT)}=${TOKEN}`,
      }),
    ).toMatchObject({ kind: "refuse", status: 401 });
    expect(
      verdictOf("GET", "/api/runs", { authorization: `Bearer ${SESSION}` }),
    ).toMatchObject({ kind: "refuse", status: 401 });
  });

  it("swaps a code for the session cookie once, and drops it from the address", () => {
    const { codes, verdictOf: verdict } = setup();
    const code = codes.mint();
    expect(verdict("GET", `/runs?code=${code}&x=1`, {})).toEqual({
      kind: "exchange",
      cookie: sessionCookie(PORT, SESSION),
      location: "/runs?x=1",
    });
    expect(sessionCookie(PORT, SESSION)).toBe(
      `ork_ui_4417=${SESSION}; HttpOnly; SameSite=Strict; Path=/`,
    );
    expect(verdict("GET", `/?code=${code}`, {})).toEqual(BAD_CODE);
  });

  it("gives a wrong code and an old ?token= link no way in", () => {
    const { verdictOf: verdict } = setup();
    expect(verdict("GET", "/?code=stale", {})).toEqual(BAD_CODE);
    expect(verdict("GET", `/?token=${TOKEN}`, {})).toMatchObject({
      kind: "refuse",
      status: 401,
      error: "Not signed in; open the UI with `ork ui`.",
    });
  });

  it("honours a code for 59 seconds and refuses it after 61, with the same text", () => {
    const { clock, codes, verdictOf: verdict } = setup();
    expect(CODE_LIFETIME_SECONDS).toBe(60);
    const fresh = codes.mint();
    const old = codes.mint();
    clock.now += 59_000;
    expect(verdict("GET", `/?code=${fresh}`, {})).toMatchObject({
      kind: "exchange",
    });
    clock.now += 2_000;
    expect(verdict("GET", `/?code=${old}`, {})).toEqual(BAD_CODE);
  });

  it("collapses leading slashes so the redirect stays on this host", () => {
    const { codes, verdictOf: verdict } = setup();
    expect(
      verdict("GET", `//evil.com/x?code=${codes.mint()}`, {}),
    ).toMatchObject({ kind: "exchange", location: "/evil.com/x" });
    expect(
      verdict("GET", `/\\evil.com/x?code=${codes.mint()}`, {}),
    ).toMatchObject({ kind: "exchange", location: "/evil.com/x" });
    expect(
      verdict("GET", `/.//evil.com/x?code=${codes.mint()}`, {}),
    ).toMatchObject({ kind: "exchange", location: "/evil.com/x" });
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
    ).toEqual(PASS_COOKIE);
  });

  it("lets a script with the bearer token write without an Origin, but not from a foreign one", () => {
    expect(
      verdictOf("POST", "/api/runs/x/stop", { ...bearer, ...json }),
    ).toEqual(PASS_BEARER);
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
    ).toEqual(PASS_BEARER);
  });

  it("compares tokens in full", () => {
    expect(sameToken(TOKEN, TOKEN)).toBe(true);
    expect(sameToken(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(sameToken("", TOKEN)).toBe(false);
  });
});
