/**
 * @file The Ork version this page was built for, set at build time from the CLI
 *   package's version (vite.config.ts). When `ork ui` answers with another, the
 *   page's scripts are older than the server, as in a tab left open across a
 *   restart; the new-version banner then offers a reload. Outside a build (the
 *   tests) it is unknown.
 */

declare const ORK_UI_VERSION: string | undefined;

export const PAGE_VERSION: string | null =
  typeof ORK_UI_VERSION === "string" ? ORK_UI_VERSION : null;
