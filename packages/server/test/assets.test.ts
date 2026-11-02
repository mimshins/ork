/**
 * @file Tests for serving the built UI: the first folder that holds one is
 *   served, `/` is its page and `/assets/…` its hashed files (cached for good),
 *   under the page's content security policy; a file outside the folder or of
 *   an unknown type is not served, and without a built UI the placeholder is.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hasUi, readAsset } from "../src/assets.ts";
import { rawGet, startTestServer, type TestServer, temp } from "./fixtures.ts";

let fixture: TestServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

/** A built UI in a temporary folder, with a secret beside it. */
const builtUi = () => {
  const outer = temp("ork-ui-dist-");
  const dir = path.join(outer, "dist");
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    "<!doctype html><title>Ork</title>",
  );
  writeFileSync(path.join(dir, "assets", "app-abc123.js"), "export {};");
  writeFileSync(path.join(dir, "assets", "notes.md"), "# not served");
  writeFileSync(path.join(outer, "secret.txt"), "outside the UI");
  return dir;
};

describe("the built UI", () => {
  it("finds a folder that holds a built UI", () => {
    expect(hasUi(builtUi())).toBe(true);
    expect(hasUi(temp("ork-ui-empty-"))).toBe(false);
  });

  it("reads only files inside the folder with a known type", () => {
    const dir = builtUi();
    expect(readAsset(dir, "/")).toMatchObject({
      type: "text/html; charset=utf-8",
      immutable: false,
    });
    expect(readAsset(dir, "/assets/app-abc123.js")).toMatchObject({
      type: "text/javascript; charset=utf-8",
      immutable: true,
    });
    expect(readAsset(dir, "/assets/notes.md")).toBeNull();
    expect(readAsset(dir, "/../secret.txt")).toBeNull();
    expect(readAsset(dir, "/%2e%2e/secret.txt")).toBeNull();
    expect(readAsset(dir, "/%E0%A4%A")).toBeNull();
    expect(readAsset(dir, "/assets")).toBeNull();
  });

  it("serves the first built UI, with its policy and caching", async () => {
    const dir = builtUi();
    fixture = await startTestServer({ ui: [temp("ork-ui-none-"), dir] });
    const page = await fixture.get("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Ork</title>");
    expect(page.headers.get("content-security-policy")).toContain(
      "style-src-attr 'unsafe-inline'",
    );
    expect(page.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(page.headers.get("cache-control")).toBe("no-store");
    const script = await fixture.get("/assets/app-abc123.js");
    expect(script.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect((await fixture.get("/assets/missing.js")).status).toBe(404);
    expect((await fixture.get("/placeholder.js")).status).toBe(404);
  });

  it("refuses a path that leaves the folder", async () => {
    fixture = await startTestServer({ ui: [builtUi()] });
    const { port } = fixture.server;
    const outside = await rawGet(
      `http://127.0.0.1:${String(port)}/%2e%2e/secret.txt`,
      {
        host: `127.0.0.1:${String(port)}`,
        authorization: `Bearer ${fixture.server.token}`,
      },
    );
    expect(outside.status).toBe(404);
    expect(outside.body).not.toContain("outside the UI");
  });

  it("serves the placeholder without a built UI", async () => {
    fixture = await startTestServer({ ui: [temp("ork-ui-none-")] });
    expect(await (await fixture.get("/")).text()).toContain("placeholder");
    expect((await fixture.get("/placeholder.js")).status).toBe(200);
  });
});
