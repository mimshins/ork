/**
 * @file Following a node's new id through expressions (RFC-008). It reads them
 *   the way the expression language does, so `nodes.a`, `nodes . a` and
 *   `nodes['a']` are all references, while a string, a field that happens to be
 *   called `nodes` and plain text are not.
 */

const IDENT_START = /[A-Za-z_]/u;
const IDENT_PART = /[A-Za-z0-9_-]/u;

const isSpace = (char: string | undefined): boolean =>
  char !== undefined && char.trim() === "";

const skipSpace = (source: string, start: number): number => {
  let at = start;
  while (isSpace(source[at])) at += 1;
  return at;
};

const identEnd = (source: string, start: number): number => {
  let at = start;
  while (at < source.length && IDENT_PART.test(source.charAt(at))) at += 1;
  return at;
};

/** Where a quoted string starting at `start` ends, past its closing quote. */
const stringEnd = (source: string, start: number): number => {
  const quote = source[start];
  let at = start + 1;
  while (at < source.length && source[at] !== quote) {
    at += source[at] === "\\" ? 2 : 1;
  }
  return at + 1;
};

/** Where the id after `nodes` sits, if there is one. */
const idAfterNodes = (
  source: string,
  afterNodes: number,
): { start: number; end: number } | undefined => {
  const next = skipSpace(source, afterNodes);
  if (source[next] === ".") {
    const start = skipSpace(source, next + 1);
    return IDENT_START.test(source.charAt(start))
      ? { start, end: identEnd(source, start) }
      : undefined;
  }
  if (source[next] !== "[") return undefined;
  const open = skipSpace(source, next + 1);
  if (source[open] !== "'" && source[open] !== '"') return undefined;
  const end = stringEnd(source, open);
  return source[skipSpace(source, end)] === "]"
    ? { start: open + 1, end: end - 1 }
    : undefined;
};

/** `source` with each reference to node `from` reading node `to`. */
export const renameInExpression = (
  source: string,
  from: string,
  to: string,
): string => {
  let out = "";
  let at = 0;
  let afterDot = false;
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === "'" || char === '"') {
      const end = stringEnd(source, at);
      out += source.slice(at, end);
      at = end;
      afterDot = false;
    } else if (IDENT_START.test(char)) {
      const end = identEnd(source, at);
      const name = source.slice(at, end);
      const place =
        name === "nodes" && !afterDot ? idAfterNodes(source, end) : undefined;
      if (
        place !== undefined &&
        source.slice(place.start, place.end) === from
      ) {
        out += `${source.slice(at, place.start)}${to}`;
        at = place.end;
      } else {
        out += name;
        at = end;
      }
      afterDot = false;
    } else {
      out += char;
      at += 1;
      if (!isSpace(char)) afterDot = char === ".";
    }
  }
  return out;
};

/** The same, for each `{{ … }}` in a template; what's around them is text. */
export const renameInTemplates = (
  text: string,
  from: string,
  to: string,
): string =>
  text.replaceAll(/\{\{.*?\}\}/gsu, part => renameInExpression(part, from, to));
