/**
 * @file A tool node's command line, split without a shell: Ork starts programs
 *   directly, so nothing in a rendered value can run as a command.
 */

/**
 * Splits a command into arguments the way a shell would, without running one:
 * whitespace separates, `'…'` is literal, `"…"` and `\` escape, and `{{ … }}`
 * stays whole so a template is rendered inside its own argument.
 */
export const tokenize = (
  command: string,
): { ok: true; args: string[] } | { ok: false; error: string } => {
  const args: string[] = [];
  let current: string | null = null;
  let index = 0;
  const add = (text: string) => {
    current = (current ?? "") + text;
  };
  while (index < command.length) {
    const char = command.charAt(index);
    if (command.startsWith("{{", index)) {
      const end = command.indexOf("}}", index + 2);
      if (end === -1) return { ok: false, error: "unclosed {{ in command" };
      add(command.slice(index, end + 2));
      index = end + 2;
    } else if (/\s/u.test(char)) {
      if (current !== null) args.push(current);
      current = null;
      index += 1;
    } else if (char === "'") {
      const end = command.indexOf("'", index + 1);
      if (end === -1) return { ok: false, error: "unclosed ' in command" };
      add(command.slice(index + 1, end));
      index = end + 1;
    } else if (char === '"') {
      let text = "";
      index += 1;
      while (index < command.length && command.charAt(index) !== '"') {
        if (command.charAt(index) === "\\") index += 1;
        text += command.charAt(index);
        index += 1;
      }
      if (index >= command.length) {
        return { ok: false, error: 'unclosed " in command' };
      }
      add(text);
      index += 1;
    } else if (char === "\\") {
      add(command.charAt(index + 1));
      index += 2;
    } else {
      add(char);
      index += 1;
    }
  }
  if (current !== null) args.push(current);
  return { ok: true, args };
};
