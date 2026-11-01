/**
 * @file The skills that ship with Ork (ADR-023), named `ork:<name>` in a
 *   workflow or on a node: each one's `SKILL.md`, kept as text so it travels
 *   inside the one bundled CLI. A built-in loads only where a workflow or node
 *   names it, at that layer; the run's plugin folder gets its file.
 */

const skill = (name: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body.trim()}\n`;

const REVIEW = skill(
  "review",
  "Use when reviewing a change in an Ork run: read it with git, check it against the brief and the project's rules, and report pass or changes_requested with findings someone can act on.",
  `
# Reviewing a change

You review; you do not rewrite. A readonly node cannot edit files, and that is
the point: your findings go back to whoever made the change.

1. **See the change.** \`git status\` and \`git diff\` (add \`--stat\` first on a big
   one; \`git log\` and \`git show\` for commits). Review what changed, not the
   whole repository.
2. **Check it against what was asked:** the brief you were given, the
   project's own rules (AGENTS.md, CLAUDE.md, its specs), and its tests when
   you may run them.
3. **Decide.** \`pass\` when it does what was asked and breaks nothing you can
   see. \`changes_requested\` when something must change before it is done;
   \`fail\` only when you could not review at all.
4. **Write findings that can be acted on**, most serious first. For each one:
   the file and line, what is wrong, why it matters, and the fix you suggest.
   Leave style preferences out unless the project's rules ask for them.
5. **Say what you did not check** (a test you could not run, a file you did not
   read), so a pass is not mistaken for more than it is.
`,
);

const BRIEF = skill(
  "brief",
  "Use when handing work to another node with delegate or spawn_worker: write a brief the child can act on without this conversation.",
  `
# Writing a brief

The node you delegate to starts without your conversation. Everything it needs
is in the brief, so write it as for a capable colleague who just arrived.

- **The goal:** what to change and why, in a sentence or two.
- **Where:** the files, folders or commands that matter, by path.
- **Limits:** what not to touch, and the scope you expect.
- **Done means:** how you will judge it (tests passing, a file written, a
  question answered), so its report says whether it got there.
- **What to report:** the artifacts you want back, by path.

One task per child. Tasks in one call run in parallel, so split work that does
not depend on itself, and give each child a different part.
`,
);

const REPORT = skill(
  "report",
  "Use when finishing a task in an Ork run: end with a structured report whose status, summary and artifacts the next node can trust.",
  `
# Ending with a report

Your report is all the next node or your owner sees of your work.

- **status:** \`pass\` when the task is done; \`changes_requested\` when you
  reviewed something that needs changes; \`fail\` when you could not do it;
  \`done\` for work that is neither pass nor fail.
- **summary:** what you did and found, in a few sentences, with the facts the
  next step needs. Not a transcript.
- **artifacts:** files you produced, by path in the repository, never their
  contents.
- **Be honest about gaps:** say what you did not verify or could not finish. A
  report that claims more than was done costs more later than one that says
  "not checked".
`,
);

/** The built-in skills by name (`ork:<name>`), as their `SKILL.md` text. */
export const BUILTIN_SKILLS: Readonly<Record<string, string>> = {
  brief: BRIEF,
  report: REPORT,
  review: REVIEW,
};
