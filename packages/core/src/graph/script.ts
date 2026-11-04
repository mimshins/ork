/**
 * @file Checks on the programs a workflow declares (RFC-006): a tool node's and
 *   a step's. A script's text takes no templates, so a value reaches a program
 *   one way, through `env:`, and can never become code. A program-less one
 *   gives a command or a script, one of them; the schema cannot say so in a way
 *   an editor shows clearly.
 */

import {
  type Diagnostic,
  type DiagnosticPath,
  type Node,
  programsOf,
  type Step,
  type Workflow,
} from "@krapht/ork-schema";

import { error, warning } from "./diagnostics.ts";

const hasText = (text: string | undefined): boolean =>
  text !== undefined && text.trim() !== "";

const checkProgram = (
  { command, script, interpreter }: Step,
  path: DiagnosticPath,
): Diagnostic[] => {
  const found: Diagnostic[] = [];
  if (hasText(command) === hasText(script)) {
    found.push(
      error("tool.command", "give a command or a script, one of them", path),
    );
  }
  if (script?.includes("{{") === true) {
    found.push(
      error(
        "script.template",
        "a script takes no templates, so a value cannot become code: pass it through env: and read it as $NAME",
        [...path, "script"],
      ),
    );
  }
  if (interpreter !== undefined && script === undefined) {
    found.push(
      error("script.interpreter", "interpreter: goes with a script:", [
        ...path,
        "interpreter",
      ]),
    );
  }
  if (interpreter?.includes("{{") === true) {
    found.push(
      error("script.interpreter", "an interpreter takes no templates", [
        ...path,
        "interpreter",
      ]),
    );
  }
  return found;
};

/** An output field a template or `when:` cannot read under a bare name. */
const fieldClash = (id: string, node: Node): Diagnostic[] => {
  const fields =
    "output" in node && node.output !== undefined && "schema" in node.output
      ? (node.output.schema ?? {})
      : {};
  return [
    ...("verify" in node && node.verify !== undefined && "verify" in fields
      ? [
          error(
            "verify.field",
            "verify: reports as output.verify, so output.schema cannot name a field verify",
            ["nodes", id, "output", "schema", "verify"],
          ),
        ]
      : []),
    ...("before" in fields
      ? [
          warning(
            "before.field",
            "a bare before means the before: step's output; read this field as output.before",
            ["nodes", id, "output", "schema", "before"],
          ),
        ]
      : []),
  ];
};

export const checkScripts = (workflow: Workflow): Diagnostic[] => [
  ...(workflow.defaults?.before === undefined
    ? []
    : checkProgram(workflow.defaults.before, ["defaults", "before"])),
  ...Object.entries(workflow.nodes).flatMap(([id, node]) =>
    fieldClash(id, node).concat(
      // An MCP call names a server's tool, and has no program to check.
      node.type === "mcp.call"
        ? []
        : programsOf(node).flatMap(({ at, program }) =>
            checkProgram(program, ["nodes", id, ...at]),
          ),
    ),
  ),
];
