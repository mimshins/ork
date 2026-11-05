/**
 * @file Checks on a program's `env:`, a tool node's or a step's: names Ork
 *   keeps for itself are refused, a literal that looks like a secret is pointed
 *   out before it reaches git, and so is a template under a name that changes
 *   which code runs. `plainEnv` must name something the node reads, and should
 *   not name a secret.
 */

import {
  type Diagnostic,
  programsOf,
  type Step,
  type Workflow,
} from "@krapht/ork-schema";

import { parseTemplate } from "../expr/evaluate.ts";
import { collectPaths } from "../expr/parse.ts";
import { error, warning } from "./diagnostics.ts";

/** A word of a name that means it holds a secret: `GHTOKEN`, `DB_PASS`. */
const SECRET_WORD =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|APIKEY|SECRETKEY|ACCESSKEY|PRIVATEKEY|CREDENTIALS?)$|^(?:KEY|PASS)$/u;

/** A last word that means it says where a secret is, not what it is. */
const POINTER_WORD = /^(?:PATH|FILE|DIR|NAME|URL|URI)$/u;

/** A word beside `TOKENS` that means it counts them, as in `MAX_TOKENS`. */
const COUNT_WORD = /^(?:MAX|MIN|NUM|COUNT|LIMIT|TOTAL)$/u;

/** A URL with a password in it, like `postgres://me:hunter2@host/db`. */
const URL_PASSWORD = /\/\/[^/\s:@]*:[^/\s@{]+@/u;

const wordsOf = (name: string): string[] =>
  name
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toUpperCase()
    .split("_");

/** `API_KEY`, `apiToken`, `API_TOKENS`; not `MAX_TOKENS` or `SSH_KEY_PATH`. */
const looksSecret = (name: string): boolean => {
  const words = wordsOf(name);
  if (POINTER_WORD.test(words.at(-1) ?? "")) return false;
  const counted = words.some(word => COUNT_WORD.test(word));
  return words.some(
    word => SECRET_WORD.test(word) || (word === "TOKENS" && !counted),
  );
};

/** Setting these from a run's output could change which code runs. */
const CODE_NAME =
  /^(?:PATH|ENV|BASH_ENV|SHELL|IFS|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|PERL5LIB|PERL5OPT|RUBYLIB|RUBYOPT|CLASSPATH|GIT_SSH|GIT_SSH_COMMAND|GIT_EXEC_PATH|GIT_ASKPASS|LD_\w+|DYLD_\w+)$/u;

/** Whether a template reads more than the user's own variables. */
const readsRunData = (value: string): boolean =>
  /\{\{\s*(?:inputs|nodes)\b/u.test(value);

/** The user's variables a value of `env:` reads through `{{env.NAME}}`. */
export const envReadsOf = (value: string): string[] => {
  const template = parseTemplate(value);
  if (!template.ok) return [];
  return template.parts.flatMap(part =>
    typeof part === "string"
      ? []
      : collectPaths(part.expr).flatMap(([root, name]) =>
          root === "env" && name !== undefined ? [String(name)] : [],
        ),
  );
};

const checkValue = (
  at: readonly (string | number)[],
  name: string,
  value: string,
): Diagnostic[] => {
  const path = [...at, "env", name];
  if (name.startsWith("ORK_")) {
    return [error("env.reserved", `${name}: Ork sets ORK_* itself`, path)];
  }
  if (URL_PASSWORD.test(value)) {
    return [
      warning(
        "env.literal",
        `${name} holds a URL with a password, and this file goes to git; use {{env.${name}}}`,
        path,
      ),
    ];
  }
  if (looksSecret(name) && value !== "" && !value.includes("{{")) {
    return [
      warning(
        "env.literal",
        `${name} looks like a secret, and this file goes to git; use {{env.${name}}}`,
        path,
      ),
    ];
  }
  return CODE_NAME.test(name) && readsRunData(value)
    ? [
        warning(
          "env.code",
          `${name} changes which code runs, and here a run's data sets it`,
          path,
        ),
      ]
    : [];
};

const checkPlain = (
  at: readonly (string | number)[],
  name: string,
  reads: readonly string[],
): Diagnostic[] => {
  const path = [...at, "plainEnv"];
  if (!reads.includes(name)) {
    return [
      warning(
        "env.plain",
        `${name}: this node's \`env:\` does not read \`{{env.${name}}}\``,
        path,
      ),
    ];
  }
  return looksSecret(name)
    ? [
        warning(
          "env.plain",
          `${name} looks like a secret, and plainEnv leaves its value unmasked`,
          path,
        ),
      ]
    : [];
};

const checkProgramEnv = (
  where: readonly (string | number)[],
  program: Step,
): Diagnostic[] => {
  const env = Object.entries(program.env ?? {});
  const reads = env.flatMap(([, value]) => envReadsOf(value));
  return env
    .flatMap(([name, value]) => checkValue(where, name, value))
    .concat(
      (program.plainEnv ?? []).flatMap(name => checkPlain(where, name, reads)),
    );
};

export const checkToolEnv = (workflow: Workflow): Diagnostic[] => [
  ...(workflow.defaults?.before === undefined
    ? []
    : checkProgramEnv(["defaults", "before"], workflow.defaults.before)),
  ...Object.entries(workflow.nodes).flatMap(([id, node]) =>
    programsOf(node).flatMap(({ at, program }) =>
      checkProgramEnv(["nodes", id, ...at], program),
    ),
  ),
];
