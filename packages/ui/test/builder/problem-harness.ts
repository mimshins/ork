/**
 * @file Shared by the tests of a control's problem: a stand-in builder with
 *   only what the controls read, and the words a control's `aria-describedby`
 *   reaches.
 */

import { draftGraph } from "@krapht/ork-server";

import type { Builder } from "../../src/builder/use-builder.ts";

const TEXT = `schemaVersion: 1
name: t
nodes:
  plan:
    type: agent.worker
    output:
      schema:
        tasks: { list: { title: string } }
  build:
    type: agent.worker
  ask:
    type: human.gate
    question: Ship?
    options: [ship, keep]
edges:
  - plan -> build
  - { from: ask, to: build, when: "choice == 'ship'" }
`;

const { graph } = draftGraph(TEXT);

// A stand-in with only what the controls read.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
export const builder = {
  view: { graph, document: {} },
  schema: {},
  catalog: { agents: [{ name: "reviewer", source: "project" }], skills: [] },
} as unknown as Builder;

/** The words each id in `aria-describedby` reaches, in order. */
export const described = (control: HTMLElement): string[] =>
  (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map(id => document.querySelector(`[id="${id}"]`)?.textContent ?? "");
