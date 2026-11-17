/**
 * @file Which shell lines read files that `extract` should read instead
 *   (RFC-025): a pipeline whose first command is a file reader (`cat`, `head`,
 *   `sed -n`, `grep`, `rg`, `find`, `git diff`…) is refused with the `extract`
 *   call to make, while a reader that filters another command's output (`pnpm
 *   test | tail -20`) is left alone, since `extract` cannot read a command's
 *   output. The function is self-contained, with no import and no outer name,
 *   because Command Code's mod embeds its source (`command-code-mod.ts`);
 *   Claude Code's hook calls it in Ork's process.
 */

// oxlint-disable unicorn/consistent-function-scoping -- the mod embeds this function's source, so its helpers must live inside it

/**
 * Why Ork refuses the shell line `line`, naming the `extract` call to make
 * instead; `undefined` when no pipeline in it starts by reading files.
 */
export const shellReadReason = (line: string): string | undefined => {
  const readers: Record<string, string> = {
    cat: "read",
    head: "read",
    tail: "read",
    less: "read",
    more: "read",
    nl: "read",
    sed: "read",
    awk: "read",
    grep: "search",
    egrep: "search",
    fgrep: "search",
    rg: "search",
    ag: "search",
    find: "files",
    tree: "files",
  };
  const gitReads: Record<string, string> = {
    diff: "diff",
    show: "show",
    log: "log",
    grep: "search",
  };
  const examples: Record<string, string> = {
    read: '`{"steps":[{"step":"read","path":"<file>","from":1,"to":80}]}`, or a match step after it to keep only the lines you need',
    search:
      '`{"steps":[{"step":"search","pattern":"<regex>","path":"<folder>"}]}`',
    files: '`{"steps":[{"step":"files","glob":"**/<name>"}]}`',
  };
  /** `text` cut at each unquoted separator `is` finds at a position. */

  const splitOn = (text: string, is: (at: number) => number): string[] => {
    const parts: string[] = [];
    let part = "";
    let quote = "";
    for (let at = 0; at < text.length; at += 1) {
      const ch = text.charAt(at);
      if (quote !== "") {
        if (ch === quote) quote = "";
        part += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        part += ch;
        continue;
      }
      const width = is(at);
      if (width > 0) {
        parts.push(part);
        part = "";
        at += width - 1;
        continue;
      }
      part += ch;
    }
    parts.push(part);
    return parts;
  };
  // Pipelines end at `;`, `&&`, `||`, `&` and line ends.
  const pipelines = splitOn(line, at => {
    const two = line.slice(at, at + 2);
    if (two === "&&" || two === "||") return 2;
    const ch = line.charAt(at);
    const redirect =
      ch === "&" &&
      (line.charAt(at + 1) === ">" ||
        line.charAt(at - 1) === ">" ||
        line.charAt(at - 1) === "<");
    return ch === ";" || ch === "\n" || ch === "\r" || (ch === "&" && !redirect)
      ? 1
      : 0;
  });
  for (const pipeline of pipelines) {
    const first =
      splitOn(pipeline, at => (pipeline.charAt(at) === "|" ? 1 : 0))[0] ?? "";
    const words = first
      .trim()
      .split(/\s+/u)
      .filter(word => word !== "");
    while (words.length > 0 && /^[A-Za-z_]\w*=/u.test(words[0] ?? "")) {
      words.shift();
    }
    const program = (words[0] ?? "").split("/").pop() ?? "";
    let kind: string | undefined;
    if (program === "git") {
      let at = 1;
      while (at < words.length && (words[at] ?? "").startsWith("-")) {
        at += words[at] === "-C" || words[at] === "-c" ? 2 : 1;
      }
      const sub = gitReads[words[at] ?? ""];
      if (sub !== undefined) {
        const example =
          sub === "search"
            ? examples["search"]
            : '`{"steps":[{"step":"git","op":"' +
              sub +
              '"}]}`, with a match step after it to keep only the lines you need';
        return `Ork refuses \`git ${words[at] ?? ""}\` here: what a shell call prints is carried on every later turn. Use the extract tool instead: ${example ?? ""}. For several files or searches, give extract several programs in one call.`;
      }
      continue;
    }
    if (program === "ls" && words.some(word => /^-\w*R/u.test(word))) {
      kind = "files";
    } else if (
      program === "sed" &&
      words.some(word => word === "--in-place" || /^-\w*i/u.test(word))
    ) {
      kind = undefined;
    } else if (
      program === "find" &&
      words.some(word =>
        ["-exec", "-execdir", "-ok", "-okdir", "-delete"].includes(word),
      )
    ) {
      kind = undefined;
    } else {
      kind = readers[program];
    }
    if (kind !== undefined) {
      return `Ork refuses \`${program}\` here: what a shell call prints is carried on every later turn. Use the extract tool instead: ${examples[kind] ?? ""}. For several files or searches, give extract several programs in one call.`;
    }
  }
  return undefined;
};

/**
 * The commands that start a shell read, for a driver that refuses by pattern
 * (OpenCode): the same programs `shellReadReason` names, and git's reads.
 */
export const SHELL_READ_COMMANDS: readonly string[] = [
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "nl",
  "sed",
  "awk",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "find",
  "tree",
  "git diff",
  "git show",
  "git log",
  "git grep",
];

/**
 * Why Ork refuses a Read of `file` in a session that cannot edit (RFC-025,
 * `extract-only`): a text file is read through `extract`; an image or a PDF,
 * which `extract` cannot read, is not refused. Self-contained, as the mod
 * embeds it too.
 */
export const textReadReason = (file: string): string | undefined =>
  /\.(?:png|jpe?g|gif|webp|bmp|svg|pdf)$/iu.test(file)
    ? undefined
    : "Ork refuses Read of `" +
      file +
      '` here: this node does not edit, so it reads through the extract tool, which returns only the part it keeps: `{"steps":[{"step":"read","path":"' +
      file +
      '","from":1,"to":80}]}`, or a match step after it. For several files, give extract several programs in one call.';
