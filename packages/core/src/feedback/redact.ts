/**
 * @file What feedback about Ork looks like before it leaves the machine
 *   (specs/feedback.md, ADR-059): secrets masked again, a project's paths
 *   rewritten to `<project>/…` and a home folder to `~`, emails, hosts and IP
 *   addresses removed, and, when asked, the repository's and workflows' names
 *   too. Then the post itself: a header of what it was seen with, the newest
 *   record's words, and a hidden marker of its fingerprint, which turns the
 *   same problem shared again into a "+1" on its thread. The preview a person
 *   confirms is exactly what is sent.
 */

import type { FeedbackItem, FeedbackRecord } from "../store/feedback-types.ts";
import { maskSecrets } from "../store/mask.ts";

export type RedactOptions = {
  /** The project roots the records came from, absolute. */
  roots: readonly string[];
  /** The person's home folder. */
  home: string;
  /** Names to hide (`--hide-names`): the repositories' and workflows'. */
  names?: readonly string[];
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const USER_FOLDER = /(?:\/Users|\/home)\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+/gu;
const URL_HOST = /\b(https?:\/\/)(?!github\.com\b)[^/\s:]+(:\d+)?/gu;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
/**
 * A bare host name, by the top-level domains hosts use, not a file's name;
 * GitHub's own stay, as links to public threads and issues.
 */
const HOST =
  /\b(?![\w.-]*github\.com\b)(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|app|cloud|internal|local|lan|corp|intranet)\b/giu;

const escaped = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** `text` with what shouldn't leave the machine taken out. */
export const redact = (text: string, options: RedactOptions): string => {
  let out = maskSecrets(text);
  const roots = [...options.roots]
    .filter(r => r !== "")
    .toSorted((a, b) => b.length - a.length);
  for (const root of roots) out = out.replaceAll(root, "<project>");
  if (options.home !== "") out = out.replaceAll(options.home, "~");
  out = out
    .replaceAll(USER_FOLDER, "~")
    .replaceAll(EMAIL, "<email>")
    .replaceAll(URL_HOST, "$1<host>")
    .replaceAll(IPV4, "<ip>")
    .replaceAll(HOST, "<host>");
  for (const name of options.names ?? []) {
    if (name.length < 2) continue;
    out = out.replaceAll(
      new RegExp(`(?<![\\w-])${escaped(name)}(?![\\w-])`, "gu"),
      "<name>",
    );
  }
  return out;
};

/** What marks a post with its item's fingerprint, hidden when rendered. */
export const fingerprintMarker = (fingerprint: string): string =>
  `<!-- ork-fingerprint: ${fingerprint} -->`;

/** The most of the newest record's words a post carries. */
const BODY_CHARS = 1500;

export type Post = {
  title: string;
  body: string;
  /** For a thread that exists already: the "+1" comment instead. */
  comment: string;
  fingerprint: string;
};

const quoted = (text: string): string =>
  text
    .slice(0, BODY_CHARS)
    .split("\n")
    .map(line => `> ${line}`)
    .join("\n");

/** What the item was seen with: Ork's version, driver, model, node, kind, count. */
const headerOf = (item: FeedbackItem, newest: FeedbackRecord | undefined) => {
  const origin = newest?.feedback.origin ?? {};
  const parts = [
    ["Ork", origin.version],
    ["driver", origin.driver],
    ["model", origin.model],
    ["node", origin.nodeType],
    ["kind", item.kind],
  ]
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `**${String(name)}** ${String(value)}`);
  return [
    ...parts,
    `**seen** ${String(item.count)} time(s) in ${String(item.runs.length)} run(s)`,
  ].join(" · ");
};

/** An `ork` item as a post to Ork's Discussions, redacted. */
export const publishPost = (
  item: FeedbackItem,
  records: readonly FeedbackRecord[],
  options: RedactOptions,
): Post => {
  const newest = records.at(-1);
  const header = redact(headerOf(item, newest), options);
  const body = newest?.feedback.body ?? "";
  const words = redact(body === "" ? item.title : body, options);
  const marker = fingerprintMarker(item.id);
  const footer = "<sub>Shared with `ork feedback publish`.</sub>";
  return {
    title: redact(item.title, options),
    body: [header, "", quoted(words), "", footer, marker].join("\n"),
    comment: ["+1 · " + header, "", quoted(words), "", footer].join("\n"),
    fingerprint: item.id,
  };
};
