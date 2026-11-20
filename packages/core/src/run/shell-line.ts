/**
 * @file The reader of a shell line (RFC-028): it takes a line apart into its
 *   simple commands, through `( … )`, `for … in …; do …; done`, `while` and
 *   `until` loops, `if`, pipes and lists, and peels the wrappers `time`, `env`,
 *   `timeout` and `nice` and leading `NAME=value` assignments off each command.
 *   It reads only forms it takes apart completely: a command, process or
 *   arithmetic substitution, a backtick, `eval`, a heredoc or here-string, a
 *   function, `case`, a `{ …; }` group, a variable or glob in a program's
 *   place, an unclosed quote, and a redirect that writes a file make the line
 *   one it cannot read (`null`), which a caller treats as unknown. The function
 *   is self-contained, with no import and no outer name, so a driver's guard
 *   can embed its source with `.toString()`.
 */

// oxlint-disable unicorn/consistent-function-scoping, max-lines -- guards embed this function's source, so its helpers must live inside it, in one module

/** One simple command of a shell line. */
export type ShellCommand = {
  /**
   * The whole command as written (assignments, wrappers and redirects too),
   * spaces collapsed.
   */
  text: string;
  /**
   * The command from its program word on, as written: what is left once
   * wrappers and assignments are peeled.
   */
  inner: string;
  /** The program and its arguments, quotes removed. */
  words: string[];
  /**
   * Per word: its value is not known before the shell runs (a variable, a glob,
   * a `$'…'` string).
   */
  dynamic: boolean[];
  /**
   * The wrappers peeled off, outermost first, each as its words (`["timeout",
   * "60"]`).
   */
  wrappers: string[][];
  /** The `NAME=value` assignments the command runs with, leading and `env`'s. */
  assignments: string[];
  /** The files it reads with `<`. */
  inputs: string[];
};

/** A shell line read with certainty: every simple command in it, in order. */
export type ShellLine = { commands: ShellCommand[] };

/**
 * The simple commands of the shell line `line`, or `null` when the line holds a
 * form this reader does not take apart with certainty.
 */
export const readShellLine = (line: string): ShellLine | null => {
  type Word = {
    kind: "word";
    raw: string;
    value: string;
    dynamic: boolean;
    plain: boolean;
  };
  type Op = { kind: "op"; op: string };
  type Redirect = { kind: "redirect"; raw: string; input?: string };
  type Token = Word | Op | Redirect;

  const fail = (): never => {
    throw new Error("unread");
  };
  const BLANK = " \t";
  const ENDS = " \t\n\r;&|()<>";
  const isEnd = (ch: string): boolean => ch === "" || ENDS.includes(ch);

  const tokenize = (): Token[] => {
    const tokens: Token[] = [];
    let raw = "";
    let value = "";
    let dynamic = false;
    let started = false;
    let wordStart = 0;
    const finish = (): void => {
      if (started) {
        tokens.push({
          kind: "word",
          raw,
          value,
          dynamic,
          plain: raw === value && !dynamic,
        });
      }
      raw = "";
      value = "";
      dynamic = false;
      started = false;
    };
    // A `$` at `at`, outside single quotes: the index after it, after marking
    // the word dynamic when it expands; substitutions fail.
    const dollar = (at: number, quoted: boolean): number => {
      const next = line.charAt(at + 1);
      if (next === "(") return fail();
      if (next === "{") {
        const close = line.indexOf("}", at + 2);
        if (close < 0) return fail();
        const name = line.slice(at + 2, close);
        if (!/^(?:[A-Za-z_]\w*|\d+|[@*#?$!-])$/u.test(name)) return fail();
        dynamic = true;
        raw += line.slice(at, close + 1);
        value += line.slice(at, close + 1);
        return close + 1;
      }
      if (!quoted && next === "'") {
        let end = at + 2;
        while (end < line.length && line.charAt(end) !== "'") {
          end += line.charAt(end) === "\\" ? 2 : 1;
        }
        if (end >= line.length) return fail();
        dynamic = true;
        raw += line.slice(at, end + 1);
        value += line.slice(at, end + 1);
        return end + 1;
      }
      if (!quoted && next === '"') return fail();
      const name = /^(?:[A-Za-z_]\w*|[0-9@*#?$!-])/u.exec(line.slice(at + 1));
      if (name === null) {
        raw += "$";
        value += "$";
        return at + 1;
      }
      dynamic = true;
      raw += "$" + name[0];
      value += "$" + name[0];
      return at + 1 + name[0].length;
    };
    // A double-quoted string opening at `from`: the index after its close.
    const doubleQuoted = (from: number): number => {
      raw += '"';
      let at = from + 1;
      while (line.charAt(at) !== '"') {
        if (at >= line.length) return fail();
        const ch = line.charAt(at);
        if (ch === "`") return fail();
        if (ch === "$") {
          at = dollar(at, true);
        } else if (ch === "\\") {
          const next = line.charAt(at + 1);
          if (next !== "\n") {
            raw += ch + next;
            value += '$`"\\'.includes(next) ? next : ch + next;
          }
          at += 2;
        } else {
          raw += ch;
          value += ch;
          at += 1;
        }
      }
      raw += '"';
      return at + 1;
    };
    // A redirect's target from `at`: a literal word, blanks before it skipped.
    const target = (at: number): { word: string; end: number } => {
      let from = at;
      while (BLANK.includes(line.charAt(from)) && from < line.length) from += 1;
      let end = from;
      while (end < line.length && !isEnd(line.charAt(end))) end += 1;
      const word = line.slice(from, end);
      if (!/^~?[\w./@%+=:,-]+$/u.test(word)) return fail();
      return { word, end };
    };
    // The fd number written just before a redirect, as part of it.
    const fdPrefix = (): string => {
      if (started && /^\d+$/u.test(raw) && raw === value && !dynamic) {
        const fd = raw;
        raw = "";
        value = "";
        started = false;
        return fd;
      }
      finish();
      return "";
    };

    let at = 0;
    while (at < line.length) {
      const ch = line.charAt(at);
      const next = line.charAt(at + 1);
      if (BLANK.includes(ch)) {
        finish();
        at += 1;
        continue;
      }
      if (ch === "\\") {
        if (at + 1 >= line.length) return fail();
        if (next === "\n") {
          at += 2;
          continue;
        }
        if (!started) wordStart = at;
        started = true;
        raw += ch + next;
        value += next;
        at += 2;
        continue;
      }
      if (ch === "'") {
        const close = line.indexOf("'", at + 1);
        if (close < 0) return fail();
        if (!started) wordStart = at;
        started = true;
        raw += line.slice(at, close + 1);
        value += line.slice(at + 1, close);
        at = close + 1;
        continue;
      }
      if (ch === '"') {
        if (!started) wordStart = at;
        started = true;
        at = doubleQuoted(at);
        continue;
      }
      if (ch === "`") return fail();
      if (ch === "$") {
        if (!started) wordStart = at;
        started = true;
        at = dollar(at, false);
        continue;
      }
      if (ch === "#" && !started) {
        while (at < line.length && line.charAt(at) !== "\n") at += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        finish();
        tokens.push({ kind: "op", op: "\n" });
        at += 1;
        continue;
      }
      if (ch === ";") {
        finish();
        if (next === ";" || next === "&") return fail();
        tokens.push({ kind: "op", op: ";" });
        at += 1;
        continue;
      }
      if (ch === "(" || ch === ")") {
        finish();
        tokens.push({ kind: "op", op: ch });
        at += 1;
        continue;
      }
      if (ch === "|") {
        finish();
        const op = next === "|" || next === "&" ? ch + next : ch;
        tokens.push({ kind: "op", op });
        at += op.length;
        continue;
      }
      if (ch === "&") {
        finish();
        if (next === "&") {
          tokens.push({ kind: "op", op: "&&" });
          at += 2;
          continue;
        }
        if (next === ">") {
          // `&>` and `&>>` send both streams: only to /dev/null.
          const from = at;
          const after = line.charAt(at + 2) === ">" ? at + 3 : at + 2;
          const { word, end } = target(after);
          if (word !== "/dev/null") return fail();
          tokens.push({ kind: "redirect", raw: line.slice(from, end) });
          at = end;
          continue;
        }
        tokens.push({ kind: "op", op: "&" });
        at += 1;
        continue;
      }
      if (ch === "<") {
        const fdStart = started ? wordStart : at;
        const fd = fdPrefix();
        if (next === "<" || next === "(" || next === "&" || next === ">") {
          return fail();
        }
        const { word, end } = target(at + 1);
        tokens.push({
          kind: "redirect",
          raw: line.slice(fd === "" ? at : fdStart, end),
          input: word,
        });
        at = end;
        continue;
      }
      if (ch === ">") {
        const fdStart = started ? wordStart : at;
        const fd = fdPrefix();
        const from = fd === "" ? at : fdStart;
        if (next === "(") return fail();
        let after = at + 1;
        if (next === ">" || next === "|") after += 1;
        if (line.charAt(after) === "&") {
          // A copy of another stream (`2>&1`, `>&-`), never a file.
          let end = after + 1;
          while (/\d/u.test(line.charAt(end))) end += 1;
          if (line.charAt(end) === "-") end += 1;
          if (end === after + 1 || !isEnd(line.charAt(end))) return fail();
          tokens.push({ kind: "redirect", raw: line.slice(from, end) });
          at = end;
          continue;
        }
        // Writing a file is an edit: output goes only to /dev/null.
        const { word, end } = target(after);
        if (word !== "/dev/null") return fail();
        tokens.push({ kind: "redirect", raw: line.slice(from, end) });
        at = end;
        continue;
      }
      if (!started) wordStart = at;
      started = true;
      // A glob or a brace expands to words not known before the shell runs.
      if ("*?[{}".includes(ch)) dynamic = true;
      raw += ch;
      value += ch;
      at += 1;
    }
    finish();
    return tokens;
  };

  const tokens: Token[] = [];
  const commands: ShellCommand[] = [];
  let p = 0;
  const peek = (): Token | undefined => tokens[p];
  const isOp = (token: Token | undefined, ...ops: string[]): boolean =>
    token?.kind === "op" && ops.includes(token.op);
  const isKeyword = (token: Token | undefined, ...words: string[]): boolean =>
    token?.kind === "word" && token.plain && words.includes(token.value);
  const expect = (...words: string[]): void => {
    if (!isKeyword(peek(), ...words)) fail();
    p += 1;
  };
  const skipNewlines = (): void => {
    while (isOp(peek(), "\n")) p += 1;
  };
  // Words that would start a form this reader does not take apart.
  const UNREAD = new Set([
    "then",
    "elif",
    "else",
    "fi",
    "do",
    "done",
    "in",
    "case",
    "esac",
    "function",
    "select",
    "coproc",
    "{",
    "}",
    "[[",
    "]]",
    "!",
    "eval",
  ]);
  const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

  // A compound command may be followed only by redirects to /dev/null or a stream.
  const trailing = (): void => {
    for (let token = peek(); token?.kind === "redirect"; token = peek()) {
      if (token.input !== undefined) fail();
      p += 1;
    }
  };

  // How many of `words`, from `at`, a known wrapper takes before its command;
  // 0 when `words[at]` is not a wrapper with a command after it.
  const wrapperLength = (words: Word[], at: number, set: string[]): number => {
    const program = words[at]?.value ?? "";
    const word = (index: number): string => {
      const found = words[index];
      if (found === undefined) return fail();
      if (found.dynamic) fail();
      return found.value;
    };
    let j = at + 1;
    if (program === "time") {
      while (j < words.length && word(j) === "-p") j += 1;
      return j < words.length ? j - at : 0;
    }
    if (program === "env") {
      for (; j < words.length; j += 1) {
        const w = word(j);
        if (w === "--") {
          j += 1;
          break;
        }
        if (!w.startsWith("-")) break;
        // `-C`/`--chdir` would move the folder the command reads from: unread.
        if (["-u", "--unset"].includes(w)) {
          word(j + 1);
          j += 1;
        } else if (
          !["-", "-i", "--ignore-environment", "-v", "--debug"].includes(w) &&
          !/^(?:--unset=|-u.)/u.test(w)
        ) {
          return fail();
        }
      }
      while (j < words.length && ASSIGNMENT.test(word(j))) {
        set.push(word(j));
        j += 1;
      }
      return j < words.length ? j - at : 0;
    }
    if (program === "timeout") {
      for (; j < words.length; j += 1) {
        const w = word(j);
        if (w === "--") {
          j += 1;
          break;
        }
        if (!w.startsWith("-")) break;
        if (["-s", "-k", "--signal", "--kill-after"].includes(w)) {
          word(j + 1);
          j += 1;
        } else if (
          !["--preserve-status", "--foreground", "-v", "--verbose"].includes(
            w,
          ) &&
          !/^(?:--signal=|--kill-after=|-s.|-k.)/u.test(w)
        ) {
          return fail();
        }
      }
      if (!/^\d+(?:\.\d+)?[smhd]?$/u.test(word(j))) fail();
      j += 1;
      return j < words.length ? j - at : fail();
    }
    if (program === "nice") {
      for (; j < words.length; j += 1) {
        const w = word(j);
        if (w === "--") {
          j += 1;
          break;
        }
        if (!w.startsWith("-")) break;
        if (w === "-n" || w === "--adjustment") {
          word(j + 1);
          j += 1;
        } else if (!/^(?:-n.|--adjustment=|-\d+$)/u.test(w)) {
          return fail();
        }
      }
      return j < words.length ? j - at : 0;
    }
    return 0;
  };

  const parseSimple = (): void => {
    const sequence: (Word | Redirect)[] = [];
    for (let token = peek(); token !== undefined; token = peek()) {
      if (token.kind === "op") break;
      sequence.push(token);
      p += 1;
    }
    const words = sequence.filter(
      (token): token is Word => token.kind === "word",
    );
    const assignments: string[] = [];
    let at = 0;
    while (at < words.length && ASSIGNMENT.test(words[at]?.raw ?? "")) {
      const assignment = words[at];
      if (assignment === undefined || assignment.dynamic) return fail();
      assignments.push(assignment.value);
      at += 1;
    }
    const wrappers: string[][] = [];
    for (;;) {
      const set: string[] = [];
      const length = wrapperLength(words, at, set);
      if (length === 0) break;
      wrappers.push(words.slice(at, at + length).map(word => word.value));
      assignments.push(...set);
      at += length;
    }
    const program = words[at];
    if (program === undefined || program.dynamic) return fail();
    if (UNREAD.has(program.value) && program.plain) return fail();
    const rest = words.slice(at);
    commands.push({
      text: sequence.map(token => token.raw).join(" "),
      inner: sequence
        .slice(sequence.indexOf(program))
        .map(token => token.raw)
        .join(" "),
      words: rest.map(word => word.value),
      dynamic: rest.map(word => word.dynamic),
      wrappers,
      assignments,
      inputs: sequence.flatMap(token =>
        token.kind === "redirect" && token.input !== undefined
          ? [token.input]
          : [],
      ),
    });
  };

  // The list up to one of `stops` (unquoted, where a command would start), a
  // `)` or the end; it holds at least one command.
  const parseList = (stops: string[]): void => {
    let count = 0;
    skipNewlines();
    for (;;) {
      const token = peek();
      if (
        token === undefined ||
        isOp(token, ")") ||
        isKeyword(token, ...stops)
      ) {
        break;
      }
      parsePipeline();
      count += 1;
      if (isOp(peek(), "&&", "||")) {
        p += 1;
        skipNewlines();
        if (peek() === undefined) fail();
        continue;
      }
      if (isOp(peek(), ";", "&", "\n")) {
        p += 1;
        skipNewlines();
        continue;
      }
      break;
    }
    if (count === 0) fail();
  };

  const parsePipeline = (): void => {
    parseCommand();
    while (isOp(peek(), "|", "|&")) {
      p += 1;
      skipNewlines();
      parseCommand();
    }
  };

  const parseCommand = (): void => {
    const token = peek();
    if (isOp(token, "(")) {
      p += 1;
      parseList([]);
      if (!isOp(peek(), ")")) fail();
      p += 1;
      trailing();
      return;
    }
    if (isKeyword(token, "for")) {
      p += 1;
      const name = peek();
      if (
        name?.kind !== "word" ||
        !name.plain ||
        !/^[A-Za-z_]\w*$/u.test(name.value)
      ) {
        fail();
      }
      p += 1;
      expect("in");
      for (let item = peek(); item?.kind === "word"; item = peek()) {
        if (item.dynamic) fail();
        p += 1;
      }
      if (!isOp(peek(), ";", "\n")) fail();
      p += 1;
      skipNewlines();
      expect("do");
      parseList(["done"]);
      expect("done");
      trailing();
      return;
    }
    if (isKeyword(token, "while", "until")) {
      p += 1;
      parseList(["do"]);
      expect("do");
      parseList(["done"]);
      expect("done");
      trailing();
      return;
    }
    if (isKeyword(token, "if")) {
      p += 1;
      parseList(["then"]);
      expect("then");
      parseList(["elif", "else", "fi"]);
      while (isKeyword(peek(), "elif")) {
        p += 1;
        parseList(["then"]);
        expect("then");
        parseList(["elif", "else", "fi"]);
      }
      if (isKeyword(peek(), "else")) {
        p += 1;
        parseList(["fi"]);
      }
      expect("fi");
      trailing();
      return;
    }
    if (token?.kind !== "word" && token?.kind !== "redirect") fail();
    parseSimple();
  };

  try {
    tokens.push(...tokenize());
    parseList([]);
  } catch {
    return null;
  }
  return p === tokens.length && commands.length > 0 ? { commands } : null;
};
