/**
 * @file A fake of the server's builder routes for the panel's tests: one
 *   workflow's text held in memory, changed by the real document edits, so what
 *   the panel sends is what a real server would apply.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  applyEdits,
  draftGraph,
  newWorkflowText,
  parseWorkflow,
} from "@krapht/ork-server";
import type { WorkflowEdit } from "@krapht/ork-server/client";
import { z } from "zod";

const SCHEMA: unknown = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../../schema/workflow.schema.json"),
    "utf8",
  ),
);

const EditsBody = z.object({ edits: z.array(z.custom<WorkflowEdit>()) });
const TextBody = z.object({ text: z.string() });

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** A server's builder routes, with one workflow's text held in memory. */
export const fakeBuilder = () => {
  const held = {
    text: "",
    saved: false,
    draft: false,
    edits: [] as WorkflowEdit[],
  };
  const viewOf = () => {
    const parsed = parseWorkflow(held.text);
    const { document, graph } = draftGraph(held.text);
    return {
      name: "fresh",
      file: "/repos/shop/.ork/workflows/fresh.ork.yaml",
      text: held.text,
      document,
      graph,
      diagnostics: parsed.ok ? [] : parsed.diagnostics,
      draft: held.draft,
      baseHash: null,
      changedOnDisk: false,
    };
  };
  const routes = (route: string, body: unknown): Response | undefined => {
    if (route === "/api/workflow-schema") return json(SCHEMA);
    if (route === "/api/projects/shop/catalog") {
      return json({
        agents: [
          { name: "reviewer", description: "Reviews.", source: "project" },
        ],
        skills: [{ name: "checklist", layer: "project" }],
      });
    }
    if (route === "/api/projects/shop/builder" && body === undefined) {
      return json([]);
    }
    if (route === "/api/projects/shop/builder") {
      held.text = newWorkflowText("fresh");
      held.draft = true;
      return json(viewOf());
    }
    if (route.endsWith("/edits")) {
      const { edits } = EditsBody.parse(body);
      held.edits.push(...edits);
      const previous = { text: held.text, baseHash: null };
      const result = applyEdits(held.text, edits);
      if (!result.ok) return json({ error: result.message }, 409);
      held.text = result.text;
      held.draft = true;
      return json({ ...viewOf(), previous });
    }
    if (route.endsWith("/text")) {
      held.text = TextBody.parse(body).text;
      return json(viewOf());
    }
    if (route.endsWith("/save")) {
      held.saved = true;
      held.draft = false;
      return json({ saved: true, file: "/f" });
    }
    return route.includes("/builder/") ? json(viewOf()) : undefined;
  };
  return { held, routes };
};
