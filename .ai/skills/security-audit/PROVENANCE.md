# Provenance

This folder is a third-party skill, kept byte for byte. Do not edit it in place.

- **Source:** <https://github.com/cloudflare/security-audit-skill>, the
  `skills/security-audit/` folder.
- **Commit:** `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.
- **License:** MIT, in `LICENSE` beside this file (the repository's root
  `LICENSE`).
- **Not installed with** `npx skills add`; it is copied here and pinned.
- **Not checked by** oxlint, oxfmt, the `@file` lint or the docs check
  (`.ai/skills/security-audit/` is in each skip list).

`PROVENANCE.md` is the only file here that is not from upstream. The
`audit` workflow (`.ork/workflows/audit.ork.yaml`) reads the phase files by
path.

## Update

An update is a deliberate change that re-pins the commit:

1. Clone the repository into a fresh empty folder outside this checkout, and
   check out the new commit. Never run its scripts from inside the clone.
2. Diff the clone's `skills/security-audit/` against this folder
   (`diff -r <clone>/skills/security-audit .ai/skills/security-audit`) and read
   the whole diff. Look for changed phases, new files, changed validator
   scripts and anything that runs code.
3. Copy the files over, and copy the clone's `LICENSE` if it changed.
4. Change the commit above, and check that the `audit` workflow's prompts still
   match the phase files.
5. Add a changeset (`pnpm changesets:empty` for internal-only work).
