/**
 * @file The new-version banner (specs/ui/workspace.md): the CLI's notice in its
 *   own row of the shell, between the top bar and the panels, so it never
 *   covers work. It says what banner-model.ts decides, with the one thing to do
 *   about it; a banner that appears while the page is open is said once, and
 *   the focus never moves to it on its own. Dismissed, it's hidden for a day
 *   for that version.
 */

import { useEffect, useRef, useState } from "react";
import { useValue } from "react-containerized-state";

import { Button, IconButton } from "../components/button.tsx";
import { CodeText } from "../components/code-text.tsx";
import { IconClose, IconUpgrade } from "../components/icons.tsx";
import { useAppState } from "../state/context.tsx";
import {
  arrivalWords,
  type Banner,
  bannerKey,
  bannerOf,
  dismissible,
} from "./banner-model.ts";
import { ReleaseLink, VersionsLine } from "./upgrade-parts.tsx";
import type { Workspace } from "./workspace.ts";

import styles from "./update.module.css";

const DISMISSED = "Dismissed for a day. Upgrade Ork… is in Commands.";

/** Says a banner that appears mid-session, once; one there at load isn't news. */
const useArrival = (
  banner: Banner | null,
  known: boolean,
  quiet: boolean,
  workspace: Workspace,
): void => {
  const said = useRef<string | null>(null);
  const key = bannerKey(banner);
  useEffect(() => {
    if (!known) return;
    const before = said.current;
    said.current = key;
    if (before === null || before === key || quiet) return;
    const words = arrivalWords(banner);
    if (words !== null) workspace.announce(words);
  }, [banner, key, known, quiet, workspace]);
};

/** The time, a minute at a time, so a day's dismissal runs out on its own. */
const useMinuteClock = (): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
};

const reloadPage = (): void => {
  window.location.reload();
};

/** Each banner's one button: its words, and the dialog it opens, if any. */
const ACTIONS: Record<
  Banner["kind"],
  { label: string; primary: boolean; opens: "ask" | "job" | null }
> = {
  newer: { label: "Upgrade…", primary: true, opens: "ask" },
  running: { label: "Show output", primary: false, opens: "job" },
  failed: { label: "Show output", primary: false, opens: "job" },
  installed: { label: "Restart…", primary: true, opens: "job" },
  pageOlder: { label: "Reload", primary: true, opens: null },
};

/** The banner's line, in the CLI's words, for all but a newer version. */
const wordsOf = (banner: Exclude<Banner, { kind: "newer" }>): string => {
  if (banner.kind === "running") return `Upgrading Ork to ${banner.latest}…`;
  if (banner.kind === "failed") {
    return `The upgrade to ${banner.latest} did not finish: exit ${String(banner.code)}.`;
  }
  return banner.kind === "installed"
    ? `Ork ${banner.latest} is installed. \`ork ui\` still runs ${banner.current} until it restarts.`
    : `This page is from Ork ${banner.page}; \`ork ui\` now runs ${banner.server}.`;
};

const Content = ({
  banner,
  onOpen,
}: {
  banner: Banner;
  onOpen: (opening: "ask" | "job") => void;
}) => {
  const action = ACTIONS[banner.kind];
  return (
    <>
      {banner.kind === "newer" ? (
        <>
          <VersionsLine
            current={banner.current}
            latest={banner.newer}
          />
          <ReleaseLink
            url={banner.releaseNotes}
            version={banner.newer}
          >
            What changed
          </ReleaseLink>
        </>
      ) : (
        <p className={styles["line"]}>
          <CodeText text={wordsOf(banner)} />
        </p>
      )}
      <span className={styles["spacer"]} />
      <Button
        cli={banner.kind === "newer" ? "ork upgrade" : undefined}
        onClick={() => {
          if (action.opens === null) reloadPage();
          else onOpen(action.opens);
        }}
        variant={action.primary ? "primary" : "default"}
      >
        {action.label}
      </Button>
    </>
  );
};

export const UpdateBanner = ({ workspace }: { workspace: Workspace }) => {
  const { version, connection, preferences } = useAppState();
  const info = useValue(version.info);
  const linked = useValue(connection);
  const chosen = useValue(preferences.value);
  const opening = useValue(version.dialog);
  const now = useMinuteClock();
  const banner = bannerOf({
    info,
    connection: linked,
    pageVersion: version.pageVersion,
    dismissed: chosen.updateDismissed,
    now,
  });
  // Known once both the versions and the server's own have been heard.
  const known = info !== null && linked.server !== null;
  useArrival(banner, known, opening !== null, workspace);
  const hides = banner === null ? null : dismissible(banner);
  return (
    <div className={styles["slot"]}>
      {banner === null ? null : (
        <section
          aria-label="New version"
          className={styles["banner"]}
        >
          <span className={styles["icon"]}>
            <IconUpgrade />
          </span>
          <Content
            banner={banner}
            onOpen={version.openDialog}
          />
          {hides === null ? null : (
            <IconButton
              label="Dismiss for a day"
              onClick={() => {
                preferences.update({
                  updateDismissed: {
                    version: hides,
                    at: new Date().toISOString(),
                  },
                });
                workspace.announce(DISMISSED);
                workspace.focusPanels();
              }}
            >
              <IconClose />
            </IconButton>
          )}
        </section>
      )}
    </div>
  );
};
