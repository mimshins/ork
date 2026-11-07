/**
 * @file The words a UI source file shows, read for the copy tests: every string
 *   literal and template literal (its `${…}` parts each read as `…`), and the
 *   text a `<code>` element opens with. Comments are skipped, and so are
 *   regular expressions, so a backtick in either is never taken for copy. It's
 *   a small scanner, not a parser: enough for the code this package writes.
 */

/** What can come just before a `/` that starts a regular expression. */
const BEFORE_REGEX = /(?:[(,=:[!&|?{};+\-*%>~^]|\breturn|\btypeof|^)\s*$/u;

/** Whether the `/` at `at` starts a regular expression, not a tag's end. */
const startsRegex = (source: string, at: number, code: string): boolean =>
  source[at - 1] !== "<" &&
  source[at + 1] !== ">" &&
  BEFORE_REGEX.test(code.slice(-12));

/** A template's `${…}` part, as the copy reads it. */
export const HOLE = "…";

type Scan = { texts: string[]; code: string };

/** Where a quoted string that starts at `start` ends, past its closing quote. */
const stringEnd = (source: string, start: number): number => {
  const quote = source[start];
  let at = start + 1;
  while (at < source.length && source[at] !== quote) {
    at += source[at] === "\\" ? 2 : 1;
  }
  return at + 1;
};

/** Where a regular expression that starts at `start` ends, past its flags. */
const regexEnd = (source: string, start: number): number => {
  let at = start + 1;
  let inClass = false;
  while (at < source.length && (inClass || source[at] !== "/")) {
    const char = source[at];
    if (char === "\\") at += 1;
    else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    at += 1;
  }
  at += 1;
  while (/[a-z]/u.test(source[at] ?? "")) at += 1;
  return at;
};

/** A string's words, its escapes undone as far as copy needs. */
const unescape = (text: string): string =>
  text.replaceAll(/\\(.)/gu, (_, char: string) => (char === "n" ? "\n" : char));

/**
 * Scans a template that starts at `start`, adding its words to `scan`; where it
 * ends, past its closing backtick.
 */
const templateEnd = (source: string, start: number, scan: Scan): number => {
  let at = start + 1;
  let words = "";
  let part = "";
  while (at < source.length && source[at] !== "`") {
    if (source[at] === "\\") {
      part += source.slice(at, at + 2);
      at += 2;
    } else if (source.startsWith("${", at)) {
      words += unescape(part) + HOLE;
      part = "";
      at = codeEnd(source, at + 2, scan, "}");
    } else {
      part += source[at];
      at += 1;
    }
  }
  scan.texts.push(words + unescape(part));
  return at + 1;
};

/**
 * Scans code from `start` until `close` at its own depth (or the end), adding
 * what it shows to `scan`; where it ends, past `close`.
 */
const codeEnd = (
  source: string,
  start: number,
  scan: Scan,
  close?: string,
): number => {
  let at = start;
  let depth = 0;
  while (at < source.length) {
    const char = source[at] ?? "";
    const next = source[at + 1];
    if (char === "/" && next === "/") {
      at = source.indexOf("\n", at);
      if (at === -1) return source.length;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end === -1 ? source.length : end + 2;
    } else if (char === "/" && startsRegex(source, at, scan.code)) {
      at = regexEnd(source, at);
      scan.code += "0";
    } else if (char === '"' || char === "'") {
      const end = stringEnd(source, at);
      scan.texts.push(unescape(source.slice(at + 1, end - 1)));
      scan.code += '""';
      at = end;
    } else if (char === "`") {
      at = templateEnd(source, at, scan);
      scan.code += '""';
    } else {
      if (char === "{") depth += 1;
      if (char === "}" && depth === 0 && close === "}") return at + 1;
      if (char === "}") depth -= 1;
      scan.code += char;
      at += 1;
    }
  }
  return at;
};

/** The words a source file shows: its strings, templates and code elements. */
export const textsOf = (source: string): string[] => {
  const scan: Scan = { texts: [], code: "" };
  codeEnd(source, 0, scan);
  const codeElements = [
    ...scan.code.matchAll(/<code(?:\s[^>]*)?>([^<{]+)/gu),
  ].map(([, text = ""]) => `\`${text.trim()}\``);
  return [...scan.texts, ...codeElements];
};
