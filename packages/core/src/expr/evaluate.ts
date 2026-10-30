import { type Expr, parseExpr } from "./parse.ts";

/**
 * What an expression can read. Bare names that are not one of these roots
 * resolve inside `output`, so `verdict == 'approve'` reads `output.verdict`.
 */
export type Scope = {
  inputs: Record<string, unknown>;
  nodes: Record<string, { output?: unknown }>;
  output?: unknown;
  run?: Record<string, unknown>;
};

export const SCOPE_ROOTS = ["inputs", "nodes", "output", "run"] as const;

const isRoot = (name: string | number): boolean =>
  (SCOPE_ROOTS as readonly (string | number)[]).includes(name);

const read = (value: unknown, segment: string | number): unknown => {
  if (value === null || typeof value !== "object") return undefined;
  if (!Object.hasOwn(value, segment)) return undefined;
  return Reflect.get(value, segment) as unknown;
};

export const resolvePath = (
  segments: readonly (string | number)[],
  scope: Scope,
): unknown => {
  const [first] = segments;
  const absolute = first !== undefined && isRoot(first);
  const path = absolute ? segments : ["output", ...segments];
  return path.reduce<unknown>((value, segment) => read(value, segment), scope);
};

const truthy = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const order = <T extends number | string>(op: string, l: T, r: T): boolean => {
  if (op === "<") return l < r;
  if (op === "<=") return l <= r;
  if (op === ">") return l > r;
  return l >= r;
};

/** `==` and `!=` are strict; ordering compares two numbers or two strings. */
const compare = (op: string, left: unknown, right: unknown): boolean => {
  if (op === "==") return left === right;
  if (op === "!=") return left !== right;
  if (typeof left === "number" && typeof right === "number") {
    return order(op, left, right);
  }
  if (typeof left === "string" && typeof right === "string") {
    return order(op, left, right);
  }
  return false;
};

/** Evaluates a parsed expression. Missing paths read as `undefined`. */
export const evaluate = (expr: Expr, scope: Scope): unknown => {
  switch (expr.kind) {
    case "literal": {
      return expr.value;
    }
    case "path": {
      return resolvePath(expr.segments, scope);
    }
    case "not": {
      return !truthy(evaluate(expr.operand, scope));
    }
    case "binary": {
      if (expr.op === "&&") {
        return (
          truthy(evaluate(expr.left, scope)) &&
          truthy(evaluate(expr.right, scope))
        );
      }
      if (expr.op === "||") {
        return (
          truthy(evaluate(expr.left, scope)) ||
          truthy(evaluate(expr.right, scope))
        );
      }
      return compare(
        expr.op,
        evaluate(expr.left, scope),
        evaluate(expr.right, scope),
      );
    }
    case "call": {
      const args = expr.args.map(arg => evaluate(arg, scope));
      const [subject, value] = args;
      const list = asList(subject);
      const matches = (item: unknown) =>
        args.length > 1 ? item === value : truthy(item);
      switch (expr.name) {
        case "any": {
          return list.some(item => matches(item));
        }
        case "all": {
          return list.length > 0 && list.every(item => matches(item));
        }
        case "count": {
          return list.filter(item => matches(item)).length;
        }
        case "len": {
          return typeof subject === "string" ? subject.length : list.length;
        }
        case "contains": {
          return typeof subject === "string" && typeof value === "string"
            ? subject.includes(value)
            : list.includes(value);
        }
        default: {
          return undefined;
        }
      }
    }
    default: {
      return undefined;
    }
  }
};

export type TemplatePart = string | { expr: Expr; offset: number };

export type TemplateParseResult =
  | { ok: true; parts: TemplatePart[] }
  | { ok: false; message: string; offset: number };

const OPEN = "{{";
const CLOSE = "}}";

/** Splits `"Hello {{inputs.name}}"` into literal text and expressions. */
export const parseTemplate = (source: string): TemplateParseResult => {
  const parts: TemplatePart[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf(OPEN, cursor);
    if (open === -1) {
      parts.push(source.slice(cursor));
      break;
    }
    if (open > cursor) parts.push(source.slice(cursor, open));
    const close = source.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      return { ok: false, message: `unclosed "${OPEN}"`, offset: open };
    }
    const inner = source.slice(open + OPEN.length, close);
    const parsed = parseExpr(inner);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.message,
        offset: open + OPEN.length + parsed.offset,
      };
    }
    parts.push({ expr: parsed.expr, offset: open });
    cursor = close + CLOSE.length;
  }
  return { ok: true, parts };
};

const stringify = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
};

export const renderTemplate = (parts: TemplatePart[], scope: Scope): string =>
  parts
    .map(part =>
      typeof part === "string" ? part : stringify(evaluate(part.expr, scope)),
    )
    .join("");
