/**
 * @file Where `ork ui` finds the built UI: `dist/ui` beside the published
 *   bundle, or, run from source, `packages/ui/dist` once it is built (`pnpm
 *   --filter @krapht/ork-ui build`). The CLI takes the UI's built files, never
 *   its source; without them the server shows its placeholder page.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** The UI package's built folder in the workspace, or null outside it. */
const workspaceUi = (): string | null => {
  try {
    const manifest = fileURLToPath(
      import.meta.resolve("@krapht/ork-ui/package.json"),
    );
    return path.join(path.dirname(manifest), "dist");
  } catch {
    return null;
  }
};

/** The folders that may hold the built UI, in the order they are tried. */
export const uiFolders = (): string[] => {
  const workspace = workspaceUi();
  return [
    path.join(import.meta.dirname, "ui"),
    ...(workspace === null ? [] : [workspace]),
  ];
};
