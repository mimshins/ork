/**
 * @file `ork ui`: starts the local server (ADR-039) on loopback and opens it in
 *   the browser, signed in with the server's token; or, when one is already
 *   running (`~/.ork/ui.json`), opens that one. The server runs nothing: runs
 *   it starts keep running when it stops, and the CLI works without it.
 */

import {
  DEFAULT_PORT,
  runningServer,
  startServer,
  uiFilePath,
} from "@krapht/ork-server";
import { defineCommand } from "citty";

import { ORK_VERSION } from "../__build_info__.ts";
import { uiFolders } from "../browser/folder.ts";
import { openInBrowser } from "../browser/open.ts";
import { style, write, writeErr } from "../output.ts";
import { mayShowSignIn } from "./in-a-run.ts";

/** The link that signs the browser in; the server swaps it for a cookie. */
export const signInLink = (port: number, token: string): string =>
  `http://127.0.0.1:${String(port)}/?token=${token}`;

/** `--port`: 0 to 65535 (0 picks a free port); `null` when invalid. */
export const portArg = (value?: string): number | null => {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : null;
};

/** Opens the link, or prints it when there is no browser to open. */
const show = async (link: string, open: boolean): Promise<void> => {
  // The link acts as the user, so a program or an agent in a run does not get it.
  if (!mayShowSignIn()) {
    writeErr(
      "A program or an agent in a run does not get the sign-in link, which acts as you. Run `ork ui` in your own terminal.",
    );
    return;
  }
  const opened = open && process.stdout.isTTY && (await openInBrowser(link));
  if (!opened) write(`Open it with this link, which signs you in: ${link}`);
};

const stopped = (): Promise<void> =>
  new Promise(resolve => {
    process.once("SIGINT", () => {
      resolve();
    });
    process.once("SIGTERM", () => {
      resolve();
    });
  });

export const ui = defineCommand({
  meta: {
    name: "ui",
    description: "Start Ork's local UI and open it, or open the running one",
  },
  args: {
    port: {
      type: "string",
      description: `The port to serve on (default ${String(DEFAULT_PORT)})`,
    },
    open: {
      type: "boolean",
      description: "Open the browser (--no-open only prints the address)",
      default: true,
    },
  },
  run: async ({ args }) => {
    const port = portArg(args.port);
    if (port === null) {
      writeErr(
        `--port must be a number from 0 to 65535, not "${args.port ?? ""}".`,
      );
      process.exitCode = 1;
      return;
    }
    const running = runningServer(uiFilePath());
    if (running !== null) {
      write(
        `Ork's UI is already running at http://127.0.0.1:${String(running.port)} (process ${String(running.pid)}).`,
      );
      await show(signInLink(running.port, running.token), args.open);
      return;
    }
    let server: Awaited<ReturnType<typeof startServer>>;
    try {
      server = await startServer({
        version: ORK_VERSION,
        port,
        ui: uiFolders(),
      });
    } catch (error) {
      writeErr(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    write(`Ork's UI is at ${server.url}`);
    write(
      style(
        "dim",
        "Runs keep running when it stops, and every ork command works without it. Ctrl-C stops it.",
      ),
    );
    await show(signInLink(server.port, server.token), args.open);
    await stopped();
    await server.close();
    write(style("dim", "Ork's UI stopped."));
  },
});
