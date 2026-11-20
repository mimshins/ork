/**
 * @file The quiet practice: keeps Ork out of a repository's shared knowledge. A
 *   project whose other contributors use their own agent tools turns nothing of
 *   Ork into files, commits or pull requests; Ork's own notes stay in its
 *   folder. Ork's own text (ADR-110).
 */

export const QUIET = `## Practice: quiet (leave no trace of Ork)

Other contributors work in this repository with their own agents and tools. Never write about Ork into anything they will read: its workflows, nodes, gates, runs, sessions, tools or follow-ups.

That covers every file of the repository (docs, specs, AGENTS.md, CLAUDE.md, memories, skills, agent files, code comments), commit messages, pull request titles and bodies, review comments and replies. Write what you learn as the repository would, tool-neutral: "the reviewer approves", not "Ork's review node passes".

Ork's own notes go in Ork's own folder, nowhere else.`;
