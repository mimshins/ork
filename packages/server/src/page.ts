/**
 * @file What the server answers outside `/api`: the built UI when there is one
 *   (else the placeholder page and its script), under a content security policy
 *   that allows only the server's own scripts, styles, fonts and connections;
 *   and plain-text notices for a person at the browser.
 */

import type { ServerResponse } from "node:http";

import { readAsset } from "./assets.ts";
import { BASE_HEADERS } from "./http.ts";
import {
  PLACEHOLDER_HTML,
  PLACEHOLDER_JS,
  PLACEHOLDER_SCRIPT,
} from "./placeholder.ts";

/**
 * No inline script and no `eval`. Inline `style` attributes are allowed
 * (`style-src-attr`): the UI's panels, popups and graph position themselves
 * with them; style sheets still come only from the server.
 */
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const send = (
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  cache?: string,
): void => {
  res
    .writeHead(status, {
      ...BASE_HEADERS,
      ...(cache === undefined ? {} : { "cache-control": cache }),
      "content-security-policy": PAGE_POLICY,
      "content-type": type,
    })
    .end(body);
};

/** A refusal for a person at the browser, not for a script. */
export const sendNotice = (
  res: ServerResponse,
  status: number,
  text: string,
): void => {
  send(res, status, "text/plain; charset=utf-8", `${text}\n`);
};

const sendPlaceholder = (res: ServerResponse, pathname: string): void => {
  if (pathname === PLACEHOLDER_SCRIPT) {
    send(res, 200, "text/javascript; charset=utf-8", PLACEHOLDER_JS);
  } else if (pathname === "/") {
    send(res, 200, "text/html; charset=utf-8", PLACEHOLDER_HTML);
  } else {
    sendNotice(res, 404, `Nothing at ${pathname}.`);
  }
};

/**
 * Answers a page request from the built UI in `uiDir` (or the placeholder
 * without one): the file, or 404 / 405.
 */
export const sendPage = (
  res: ServerResponse,
  method: string,
  pathname: string,
  uiDir: string | undefined,
): void => {
  if (method !== "GET" && method !== "HEAD") {
    sendNotice(res, 405, `${method} is not allowed here.`);
    return;
  }
  if (uiDir === undefined) {
    sendPlaceholder(res, pathname);
    return;
  }
  const asset = readAsset(uiDir, pathname);
  if (asset === null) sendNotice(res, 404, `Nothing at ${pathname}.`);
  else {
    send(
      res,
      200,
      asset.type,
      asset.body,
      asset.immutable ? "public, max-age=31536000, immutable" : undefined,
    );
  }
};
