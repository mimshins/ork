/**
 * @file The write limit (`SessionSpec.writeOnly`): a session whose edit tools
 *   may write only under some folders of its checkout, and never to a file
 *   named CLAUDE.md or AGENTS.md. One rule for every driver: the Claude Code
 *   hook calls it, and the matcher the other drivers carry embeds its source,
 *   so it is self-contained (no import, no outer name).
 */

/**
 * Why an edit of `files` is refused under `writeOnly`, or `undefined` when it
 * may run. `files` are relative to the session's folder, `/`-separated, links
 * followed (`../…` is outside it); `null` when the call names none Ork can
 * read. The reason reads after "Ork: <tool> is", and says where to write.
 */
export const writeOnlyReason = (
  files: readonly string[] | null,
  writeOnly: readonly string[],
): string | undefined => {
  const named = writeOnly.map(each => "`" + each + "`").join(", ");
  const where =
    "this session writes only under " +
    named +
    ", and never to a file named CLAUDE.md or AGENTS.md";
  if (files === null || files.length === 0) {
    return "refused: it names no file Ork can check (" + where + ")";
  }
  const bases = writeOnly.map(each =>
    each === "." ? "" : each.replace(/^\.\//u, "").replace(/\/+$/u, ""),
  );
  const allowed = (file: string): boolean =>
    !/(?:^|\/)(?:CLAUDE|AGENTS)\.md$/iu.test(file) &&
    file !== ".." &&
    !file.startsWith("../") &&
    !file.startsWith("/") &&
    bases.some(
      base => base === "" || file === base || file.startsWith(base + "/"),
    );
  return files.every(file => allowed(file))
    ? undefined
    : "refused for this file (" + where + ")";
};
