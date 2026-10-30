/**
 * @file A small, safe expression language for `when:` conditions and `{{ }}`
 *   templates. It has literals, dotted paths, comparisons, `&&`, `||`, `!`, and
 *   a fixed set of functions. There is no assignment, no property call, and no
 *   way to reach JavaScript.
 */

export type BinaryOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";

export type Expr =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "path"; segments: (string | number)[] }
  | { kind: "call"; name: FunctionName; args: Expr[] }
  | { kind: "not"; operand: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr };

export const FUNCTIONS = ["any", "all", "count", "len", "contains"] as const;
export type FunctionName = (typeof FUNCTIONS)[number];

export type ParseResult =
  | { ok: true; expr: Expr }
  | { ok: false; message: string; offset: number };

type Token =
  | { type: "number"; value: number; offset: number }
  | { type: "string"; value: string; offset: number }
  | { type: "ident"; value: string; offset: number }
  | { type: "punct"; value: string; offset: number }
  | { type: "end"; offset: number };

class ExprError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.offset = offset;
  }
}

const PUNCTUATION = [
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<",
  ">",
  "!",
  "(",
  ")",
  ",",
  ".",
  "[",
  "]",
];

const IDENT_START = /[A-Za-z_]/u;
const IDENT_PART = /[A-Za-z0-9_-]/u;
const DIGIT = /[0-9]/u;

const readString = (source: string, start: number): [string, number] => {
  const quote = source[start];
  let value = "";
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === "\\" && i + 1 < source.length) i += 1;
    value += source[i];
    i += 1;
  }
  if (i >= source.length) throw new ExprError("unterminated string", start);
  return [value, i + 1];
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char.trim() === "") {
      i += 1;
    } else if (char === "'" || char === '"') {
      const [value, next] = readString(source, i);
      tokens.push({ type: "string", value, offset: i });
      i = next;
    } else if (DIGIT.test(char)) {
      let end = i;
      while (end < source.length && /[0-9.]/u.test(source.charAt(end))) {
        end += 1;
      }
      const value = Number(source.slice(i, end));
      if (Number.isNaN(value)) throw new ExprError("invalid number", i);
      tokens.push({ type: "number", value, offset: i });
      i = end;
    } else if (IDENT_START.test(char)) {
      let end = i;
      while (end < source.length && IDENT_PART.test(source.charAt(end))) {
        end += 1;
      }
      tokens.push({ type: "ident", value: source.slice(i, end), offset: i });
      i = end;
    } else {
      const at = i;
      const punct = PUNCTUATION.find(p => source.startsWith(p, at));
      if (punct === undefined) {
        throw new ExprError(`unexpected character "${char}"`, i);
      }
      tokens.push({ type: "punct", value: punct, offset: i });
      i += punct.length;
    }
  }
  tokens.push({ type: "end", offset: source.length });
  return tokens;
};

const KEYWORDS: Record<string, Expr> = {
  true: { kind: "literal", value: true },
  false: { kind: "literal", value: false },
  null: { kind: "literal", value: null },
};

const COMPARISONS = new Set<string>(["==", "!=", "<", "<=", ">", ">="]);

const isComparison = (value: string): value is BinaryOp =>
  COMPARISONS.has(value);

const isFunctionName = (name: string): name is FunctionName =>
  (FUNCTIONS as readonly string[]).includes(name);

/** Recursive-descent parser over the token list. */
const createParser = (tokens: Token[]) => {
  let position = 0;
  const peek = (): Token => tokens[position] ?? { type: "end", offset: 0 };
  const next = (): Token => {
    const token = peek();
    position += 1;
    return token;
  };
  const isPunct = (value: string) => {
    const token = peek();
    return token.type === "punct" && token.value === value;
  };
  const expect = (value: string) => {
    const token = next();
    if (token.type !== "punct" || token.value !== value) {
      throw new ExprError(`expected "${value}"`, token.offset);
    }
  };

  const parsePath = (first: string): Expr => {
    const segments: (string | number)[] = [first];
    while (isPunct(".") || isPunct("[")) {
      const bracket = isPunct("[");
      next();
      const token = next();
      if (bracket) {
        if (token.type !== "number" && token.type !== "string") {
          throw new ExprError("expected an index", token.offset);
        }
        segments.push(token.value);
        expect("]");
      } else {
        if (token.type !== "ident") {
          throw new ExprError("expected a name after '.'", token.offset);
        }
        segments.push(token.value);
      }
    }
    return { kind: "path", segments };
  };

  const parsePrimary = (): Expr => {
    const token = next();
    switch (token.type) {
      case "number":
      case "string": {
        return { kind: "literal", value: token.value };
      }
      case "ident": {
        const keyword = KEYWORDS[token.value];
        if (keyword !== undefined) return keyword;
        if (!isPunct("(")) return parsePath(token.value);
        if (!isFunctionName(token.value)) {
          throw new ExprError(
            `unknown function "${token.value}" (have: ${FUNCTIONS.join(", ")})`,
            token.offset,
          );
        }
        next();
        const args: Expr[] = [];
        while (!isPunct(")")) {
          args.push(parseOr());
          if (!isPunct(")")) expect(",");
        }
        expect(")");
        return { kind: "call", name: token.value, args };
      }
      case "punct": {
        if (token.value === "(") {
          const inner = parseOr();
          expect(")");
          return inner;
        }
        throw new ExprError(`unexpected "${token.value}"`, token.offset);
      }
      case "end": {
        throw new ExprError("unexpected end of expression", token.offset);
      }
      default: {
        throw new ExprError("unexpected token", 0);
      }
    }
  };

  const parseUnary = (): Expr => {
    if (isPunct("!")) {
      next();
      return { kind: "not", operand: parseUnary() };
    }
    return parsePrimary();
  };

  const parseComparison = (): Expr => {
    const left = parseUnary();
    const token = peek();
    if (token.type === "punct" && isComparison(token.value)) {
      next();
      return { kind: "binary", op: token.value, left, right: parseUnary() };
    }
    return left;
  };

  const parseAnd = (): Expr => {
    let left = parseComparison();
    while (isPunct("&&")) {
      next();
      left = { kind: "binary", op: "&&", left, right: parseComparison() };
    }
    return left;
  };

  const parseOr = (): Expr => {
    let left = parseAnd();
    while (isPunct("||")) {
      next();
      left = { kind: "binary", op: "||", left, right: parseAnd() };
    }
    return left;
  };

  return {
    parse: (): Expr => {
      const expr = parseOr();
      const token = peek();
      if (token.type !== "end") {
        throw new ExprError("unexpected input after expression", token.offset);
      }
      return expr;
    },
  };
};

export const parseExpr = (source: string): ParseResult => {
  try {
    return { ok: true, expr: createParser(tokenize(source)).parse() };
  } catch (error) {
    if (error instanceof ExprError) {
      return { ok: false, message: error.message, offset: error.offset };
    }
    throw error;
  }
};

/** Every path an expression reads, e.g. `[["inputs", "feature"]]`. */
export const collectPaths = (expr: Expr): (string | number)[][] => {
  switch (expr.kind) {
    case "literal": {
      return [];
    }
    case "path": {
      return [expr.segments];
    }
    case "call": {
      return expr.args.flatMap(collectPaths);
    }
    case "not": {
      return collectPaths(expr.operand);
    }
    case "binary": {
      return [...collectPaths(expr.left), ...collectPaths(expr.right)];
    }
    default: {
      return [];
    }
  }
};
