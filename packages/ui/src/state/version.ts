/**
 * @file What the page knows of Ork's versions (specs/cli/updates.md): what `ork
 *   ui` reports, from the CLI's record and its one upgrade, fed by the overview
 *   stream's `version` (so a version found while the page is open shows without
 *   a reload); the page's own version, to tell a tab left open across a
 *   restart; whether the Upgrade dialog is open, and on what; and whether it
 *   waits for the restart it asked for, while the lost connection is expected.
 */

import type { Client, VersionInfo } from "@krapht/ork-server/client";
import { Container } from "react-containerized-state";

import type { OpenSource } from "./stream-link.ts";

/** The Upgrade dialog: asking the registry anew, or on the server's job. */
export type UpgradeOpening = "ask" | "job";

export const createVersion = ({
  client,
  open,
  pageVersion,
}: {
  client: Client;
  /** Opens the upgrade's stream. */
  open: OpenSource;
  pageVersion: string | null;
}) => {
  const info = Container.create<VersionInfo | null>(null);
  const dialog = Container.create<UpgradeOpening | null>(null);
  const restarting = Container.create(false);
  return {
    info,
    open,
    /** The Ork version this page was built for; null when unknown. */
    pageVersion,
    dialog,
    /** The dialog waits for `ork ui` to come back from its restart. */
    restarting,
    receive: (next: VersionInfo): void => {
      void info.setValue(next);
    },
    /** Reads it again, as after the dialog asked the registry. */
    refresh: async (): Promise<void> => {
      const answer = await client.call("version");
      if (answer.ok) void info.setValue(answer.data);
    },
    openDialog: (opening: UpgradeOpening): void => {
      void dialog.setValue(opening);
    },
    closeDialog: (): void => {
      void dialog.setValue(null);
    },
  };
};

export type VersionState = ReturnType<typeof createVersion>;
