/**
 * @file What the server answers outside `/api`: the page (the placeholder until
 *   the UI is built) and its script, under a content security policy that
 *   allows only the server's own scripts and connections, and plain-text
 *   notices for a person at the browser.
 */

import type { ServerResponse } from "node:http";

import { BASE_HEADERS } from "./http.ts";
import {
  PLACEHOLDER_HTML,
  PLACEHOLDER_JS,
  PLACEHOLDER_SCRIPT,
} from "./placeholder.ts";

const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const sendText = (
  res: ServerResponse,
  status: number,
  type: string,
  body: string,
): void => {
  res
    .writeHead(status, {
      ...BASE_HEADERS,
      "content-security-policy": PAGE_POLICY,
      "content-type": `${type}; charset=utf-8`,
    })
    .end(body);
};

/** A refusal for a person at the browser, not for a script. */
export const sendNotice = (
  res: ServerResponse,
  status: number,
  text: string,
): void => {
  sendText(res, status, "text/plain", `${text}\n`);
};

/** Answers a page request: the page, its script, or 404 / 405. */
export const sendPage = (
  res: ServerResponse,
  method: string,
  pathname: string,
): void => {
  if (method !== "GET" && method !== "HEAD") {
    sendNotice(res, 405, `${method} is not allowed here.`);
  } else if (pathname === PLACEHOLDER_SCRIPT) {
    sendText(res, 200, "text/javascript", PLACEHOLDER_JS);
  } else if (pathname === "/") {
    sendText(res, 200, "text/html", PLACEHOLDER_HTML);
  } else {
    sendNotice(res, 404, `Nothing at ${pathname}.`);
  }
};
