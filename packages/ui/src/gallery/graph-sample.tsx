/**
 * @file The gallery's graph: a team with reviewers, a join, a loop back with a
 *   condition, a gate, a channel and a workflow call, in every kind of state.
 */

import { useState } from "react";

import type { NodeFacts } from "../graph/facts.ts";
import { GraphView } from "../graph/graph-view.tsx";
import { layoutGraph } from "../graph/layout.ts";
import { Section } from "./section.tsx";

import styles from "./gallery.module.css";

const LAYOUT = layoutGraph({
  nodes: [
    { id: "spec", type: "claude.worker" },
    { id: "builder", type: "claude.leader" },
    { id: "security", type: "claude.worker", parent: "builder" },
    { id: "ux", type: "claude.worker", parent: "builder" },
    { id: "code", type: "claude.worker", parent: "builder" },
    { id: "reviews", type: "control.join" },
    { id: "approver", type: "claude.worker" },
    { id: "client-kit", type: "workflow.call" },
    { id: "human", type: "human.gate" },
    { id: "merge", type: "tool.gh" },
  ],
  edges: [
    { from: "spec", to: "builder" },
    { from: "builder", to: "security" },
    { from: "builder", to: "ux" },
    { from: "builder", to: "code" },
    { from: "security", to: "reviews" },
    { from: "ux", to: "reviews" },
    { from: "code", to: "reviews" },
    { from: "reviews", to: "builder", when: "any(fail)", maxRounds: 2 },
    { from: "reviews", to: "approver", when: "all(pass)" },
    { from: "approver", to: "merge", when: "verdict == 'approve'" },
    { from: "approver", to: "human", when: "verdict == 'escalate'" },
    { from: "human", to: "merge", when: "choice == 'merge'" },
    { from: "builder", to: "client-kit" },
    { from: "client-kit", to: "merge" },
  ],
  channels: [["code", "client-kit"]],
});

const FACTS = new Map<string, NodeFacts>([
  [
    "spec",
    { status: "succeeded", model: "opus", tokens: 18_240, costUsd: 0.4123 },
  ],
  [
    "builder",
    {
      status: "running",
      model: "opus",
      tokens: 52_810,
      costUsd: 1.204,
      cli: "ork logs 4f2a1c --node builder",
    },
  ],
  ["security", { status: "paused", model: "opus", tokens: 3120 }],
  ["ux", { status: "waiting", model: "sonnet", tokens: 980 }],
  [
    "code",
    { status: "failed", model: "sonnet", tokens: 7700, costUsd: 0.0312 },
  ],
  ["reviews", { status: "skipped" }],
  ["client-kit", { status: "running", tokens: 300, costUsd: 0.0136 }],
  ["approver", { status: "interrupted", model: "opus" }],
]);

export const GraphSample = () => {
  const [selected, setSelected] = useState<string>("builder");
  return (
    <Section title="Graph">
      <div className={styles["graph"]}>
        <GraphView
          facts={FACTS}
          label="A sample workflow"
          layout={LAYOUT}
          onSelect={setSelected}
          selected={selected}
        />
      </div>
    </Section>
  );
};
