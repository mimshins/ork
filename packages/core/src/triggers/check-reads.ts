/**
 * @file What a trigger's check runs beyond its own words, for the hash a person
 *   accepts: the `.mcp.json` its server comes from, and the project's files its
 *   command, interpreter or server program names (`--config=./x.json` names
 *   `./x.json`). What those files read in turn, a program outside the project
 *   and a path built from an env variable are not in it. Only files inside the
 *   project are read, and their text goes into the hash, never anywhere else.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { TriggerCheck } from "@krapht/ork-schema";

import { inside } from "../context/files.ts";
import { MCP_FILE, serversIn } from "../project/mcp-file.ts";

/** A file's text; `undefined` only when it isn't there. Anything else throws. */
export const readText = (file: string): string | undefined => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

const isFile = (file: string): boolean =>
  statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/**
 * What a word names, if it is a file in the project: the word and the file's
 * text. A file outside the project, a missing one and a word that is no file
 * add nothing.
 */
const fileRead = (root: string, from: string, word: string): string[] => {
  const file = path.resolve(from, word.replace(/^-{1,2}[^=\s]+=/u, ""));
  return word !== "" && inside(root, file) && isFile(file)
    ? [`${word}\0${readFileSync(file, "utf8")}`]
    : [];
};

/** The in-repo files a stdio server's program and arguments name. */
const serverReads = (root: string, server: string): string[] => {
  const read = serversIn(root);
  const entry = read.ok ? read.value[server] : undefined;
  if (typeof entry !== "object" || entry === null) return [];
  const command: unknown = Reflect.get(entry, "command");
  const args: unknown = Reflect.get(entry, "args");
  const rest: unknown[] = Array.isArray(args) ? args : [];
  // The executor spawns a server from the project root, so words resolve there.
  return [command, ...rest].flatMap(word =>
    typeof word === "string" ? fileRead(root, root, word) : [],
  );
};

/** The texts a check's hash covers beyond its own words. */
export const checkReads = (
  root: string,
  check: TriggerCheck | undefined,
): string[] => {
  if (check === undefined) return [];
  if (check.type === "mcp.call") {
    return [
      readText(path.join(root, MCP_FILE)) ?? "",
      ...serverReads(root, check.server),
    ];
  }
  const from = path.resolve(root, check.cwd ?? ".");
  return [check.command, check.interpreter]
    .join(" ")
    .split(/\s+/u)
    .flatMap(word => fileRead(root, from, word));
};
