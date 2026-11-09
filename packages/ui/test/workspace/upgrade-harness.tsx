/**
 * @file The new-version tests' setup: the banner and the Upgrade dialog drawn
 *   on the fake `ork ui` of upgrade-fake.ts (or the whole shell, as the page
 *   draws them), and how to drive and read them: the overview stream's
 *   versions, the upgrade's stream, and what was announced.
 */

import type { VersionInfo } from "@krapht/ork-server/client";
import { act, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import { TipProvider } from "../../src/components/tip.tsx";
import { AppStateProvider } from "../../src/state/context.tsx";
import { WorkspaceContext } from "../../src/workspace/context.ts";
import { Shell } from "../../src/workspace/shell.tsx";
import { UpdateBanner } from "../../src/workspace/update-banner.tsx";
import { UpgradeDialog } from "../../src/workspace/upgrade-dialog.tsx";
import { type FakeOptions, openFakeUpgrade } from "./upgrade-fake.ts";

export const openUpgrade = (
  over: FakeOptions & {
    /** Draw the whole shell around them, as the page does. */
    shell?: boolean;
  } = {},
) => {
  const fake = openFakeUpgrade(over);
  const { state, workspace, reload } = fake;
  const view = render(
    <AppStateProvider value={state}>
      <TipProvider>
        {over.shell === true ? (
          <Shell workspace={workspace} />
        ) : (
          <WorkspaceContext value={workspace}>
            <UpdateBanner workspace={workspace} />
            <UpgradeDialog
              reload={reload}
              timing={{ pollMs: 5, waitMs: 400, reloadMs: 5 }}
            />
          </WorkspaceContext>
        )}
      </TipProvider>
    </AppStateProvider>,
  );
  return { ...view, ...fake };
};

export type Opened = ReturnType<typeof openUpgrade>;

const answered = (opened: Opened): void => {
  if (opened.state.connection.getValue().server === null) {
    throw new Error("The server hasn't answered yet.");
  }
};

/** The overview stream opens and sends what the server knows of versions. */
export const connect = async (
  opened: Opened,
  version: VersionInfo = opened.server.version,
): Promise<void> => {
  await act(async () => {
    opened.overview.connected();
    opened.overview.send("version", version);
    await Promise.resolve();
  });
  await vi.waitFor(() => {
    answered(opened);
  });
};

export const banner = () =>
  screen.queryByRole("region", { name: "New version" });

export const dialog = () => within(screen.getByRole("dialog"));

/** The upgrade's output stream, once the dialog opened one. */
export const upgradeStream = (opened: Opened) => {
  const source = opened.sources.all.find(s =>
    s.url.startsWith("/api/upgrade/stream"),
  );
  if (source === undefined) throw new Error("No upgrade stream was opened.");
  return source;
};

/** The words announced so far. */
export const announced = (opened: Opened): string[] =>
  opened.said.mock.calls.map(([words]) => words);
