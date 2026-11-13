/**
 * @file `ork ui`: starts the local server (ADR-039) on loopback and opens it in
 *   the browser, signed in with a single-use code the server mints (RFC-019);
 *   or, when one is already running (`~/.ork/ui.json`), opens that one. The
 *   command supervises the server in a child process, so the page can restart
 *   it onto a newly installed `ork` (ADR-060). The server runs nothing: runs it
 *   starts keep running when it stops, and the CLI works without it.
 */

import {
  createClient,
  DEFAULT_PORT,
  newToken,
  runningServer,
  uiFilePath,
} from "@krapht/ork-server";
import { defineCommand } from "citty";

import { openInBrowser } from "../browser/open.ts";
import { serveForSupervisor } from "../browser/serve.ts";
import {
  onStopSignals,
  type Ready,
  spawnServerFrom,
  supervise,
} from "../browser/supervise.ts";
import { style, write, writeErr } from "../output.ts";
import { mayShowSignIn } from "./in-a-run.ts";

/** The link that signs the browser in; the server swaps its code for a cookie. */
export const signInLink = (port: number, code: string): string =>
  `http://127.0.0.1:${String(port)}/?code=${code}`;

/** What `ork ui` says when it can't get a sign-in code from the server. */
export const MINT_FAILED_OLDER =
  "The running UI is from an older Ork; stop it and run `ork ui`.";

/**
 * Gets a single-use sign-in code from the server with the API token, and
 * returns the link for it, or the reason there is none. The token only goes in
 * this request's header, never in a link or an argument.
 */
export const mintSignInLink = async (
  port: number,
  token: string,
  fetchFn?: typeof fetch,
): Promise<{ link: string } | { failure: string }> => {
  const client = createClient({
    base: `http://127.0.0.1:${String(port)}`,
    token,
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
  });
  const answer = await client.call("signIn");
  if (answer.ok) return { link: signInLink(port, answer.data.code) };
  // An older server has no such route (404), or is gone (no answer).
  return {
    failure:
      answer.status === 404 || answer.status === 0
        ? MINT_FAILED_OLDER
        : `Could not get a sign-in code: ${answer.error}`,
  };
};

/** `--port`: 0 to 65535 (0 picks a free port); `null` when invalid. */
export const portArg = (value?: string): number | null => {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : null;
};

/** Opens the sign-in link, or prints it when there is no browser to open. */
const show = async (
  port: number,
  token: string,
  open: boolean,
): Promise<void> => {
  // The link acts as the user, so a program or an agent in a run does not get
  // it, and no code is minted for one.
  if (!mayShowSignIn()) {
    writeErr(
      "A program or an agent in a run does not get the sign-in link, which acts as you. Run `ork ui` in your own terminal.",
    );
    return;
  }
  const minted = await mintSignInLink(port, token);
  if ("failure" in minted) {
    writeErr(minted.failure);
    return;
  }
  const { link } = minted;
  const opened = open && process.stdout.isTTY && (await openInBrowser(link));
  if (!opened) write(`Open it with this link, which signs you in: ${link}`);
};

/** What `ork ui` says once its server serves, the first time or again. */
const ready = async (
  { port, version, restarted }: Ready,
  token: string,
  open: boolean,
): Promise<void> => {
  const url = `http://127.0.0.1:${String(port)}`;
  if (restarted) {
    write(`Ork's UI restarted: Ork ${version} at ${url}`);
    return;
  }
  write(`Ork's UI is at ${url}`);
  write(
    style(
      "dim",
      "Runs keep running when it stops, and every ork command works without it. Ctrl-C stops it.",
    ),
  );
  await show(port, token, open);
};

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
    serve: {
      type: "boolean",
      description: "Only for `ork ui` itself: be the server it supervises",
      default: false,
    },
  },
  run: async ({ args }) => {
    const port = portArg(args.port);
    if (port === null) {
      writeErr(
        `--port must be a number from 0 to 65535, not \`${args.port ?? ""}\`.`,
      );
      process.exitCode = 1;
      return;
    }
    if (args.serve) {
      await serveForSupervisor();
      return;
    }
    const running = runningServer(uiFilePath());
    if (running !== null) {
      write(
        `Ork's UI is already running at http://127.0.0.1:${String(running.port)} (process ${String(running.pid)}).`,
      );
      await show(running.port, running.token, args.open);
      return;
    }
    const token = newToken();
    process.exitCode = await supervise({
      port,
      token,
      spawnServer: spawnServerFrom(process.argv[1] ?? ""),
      onReady: answer => ready(answer, token, args.open),
      onStop: onStopSignals,
      say: line => {
        write(style("dim", line));
      },
      sayErr: writeErr,
    });
  },
});
