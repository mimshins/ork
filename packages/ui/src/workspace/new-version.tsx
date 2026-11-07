/**
 * @file The shell's new-version row and the Upgrade dialog it and the palette
 *   open (specs/ui/workspace.md): the banner takes the row between the top bar
 *   and the panels, and no room when there is nothing to say.
 */

import { UpdateBanner } from "./update-banner.tsx";
import { UpgradeDialog } from "./upgrade-dialog.tsx";
import type { Workspace } from "./workspace.ts";

export const NewVersion = ({ workspace }: { workspace: Workspace }) => (
  <>
    <UpdateBanner workspace={workspace} />
    <UpgradeDialog />
  </>
);
