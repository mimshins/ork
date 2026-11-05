/**
 * @file A fake of the builder's routes with several workflows in two projects,
 *   whose answers can be held back, to play what happens when a person is
 *   quicker than the server. The edits are the real ones.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { applyEdits, draftGraph, parseWorkflow } from "@krapht/ork-server";
import type { WorkflowEdit } from "@krapht/ork-server/client";
import { z } from "zod";

const SCHEMA: unknown = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../../schema/workflow.schema.json"),
    "utf8",
  ),
);

export const workflowText = (name: string, more = ""): string =>
  `schemaVersion: 1\nname: ${name}\nnodes:\n  n:\n    type: tool.shell\n    command: x\n${more}`;

const EditsBody = z.object({ edits: z.array(z.custom<WorkflowEdit>()) });
const TextBody = z.object({ text: z.string() });

const ROUTE = /^\/api\/projects\/(\w+)\/builder\/([^/]+)(?:\/(\w+))?$/u;

export const fakeWorkflows = () => {
  const files: Record<string, { text: string; draft: boolean }> = {
    a: { text: workflowText("a"), draft: false },
    b: { text: workflowText("b"), draft: false },
    c: { text: workflowText("c"), draft: false },
  };
  /** What was sent, in order, as `<op> <workflow>`. */
  const log: string[] = [];
  const sent: WorkflowEdit[] = [];
  const holds: { match: (route: string) => boolean; ms: number }[] = [];
  const respond = (route: string, body: unknown, status = 200): Response => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    const hold = holds.find(({ match }) => match(route));
    return hold === undefined
      ? new Response(bytes, { status })
      : new Response(
          new ReadableStream({
            start: async writer => {
              await new Promise(resolve => {
                setTimeout(resolve, hold.ms);
              });
              writer.enqueue(bytes);
              writer.close();
            },
          }),
          { status },
        );
  };
  const viewOf = (name: string) => {
    const file = files[name] ?? { text: "", draft: false };
    const { document, graph } = draftGraph(file.text);
    const parsed = parseWorkflow(file.text);
    return {
      name,
      file: `/repos/${name}.ork.yaml`,
      text: file.text,
      document,
      graph,
      diagnostics: parsed.ok ? [] : parsed.diagnostics,
      walk: parsed.ok ? "Walked 2 ways through: 1 succeeds, 1 fails." : null,
      draft: file.draft,
      baseHash: null,
      changedOnDisk: false,
    };
  };
  const act = (
    route: string,
    name: string,
    op: string | undefined,
    body: unknown,
  ): Response => {
    const file = files[name];
    if (file === undefined) return respond(route, { error: "gone" }, 404);
    log.push(`${op ?? "view"} ${name}`);
    if (op === "edits") {
      const { edits } = EditsBody.parse(body);
      sent.push(...edits);
      const previous = { text: file.text, baseHash: null };
      const result = applyEdits(file.text, edits);
      if (!result.ok) return respond(route, { error: result.message }, 409);
      file.text = result.text;
      file.draft = true;
      return respond(route, { ...viewOf(name), previous });
    }
    if (op === "text") file.text = TextBody.parse(body).text;
    if (op === "text") file.draft = true;
    if (op === "discard") file.draft = false;
    if (op === "save") {
      file.draft = false;
      return respond(route, { saved: true, file: "/f" });
    }
    return respond(route, viewOf(name));
  };
  const routes = (route: string, body: unknown): Response | undefined => {
    if (route === "/api/workflow-schema") return respond(route, SCHEMA);
    if (route.endsWith("/catalog")) {
      return respond(route, {
        agents: [],
        skills: [{ name: "checklist", layer: "project" }],
      });
    }
    if (/^\/api\/projects\/\w+\/builder$/u.test(route)) {
      return respond(route, []);
    }
    const found = ROUTE.exec(route);
    return found === null
      ? undefined
      : act(route, found[2] ?? "", found[3], body);
  };
  return { files, log, sent, holds, routes };
};
