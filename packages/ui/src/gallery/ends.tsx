/**
 * @file The gallery's end kinds: the end badge for each actor, plain and as a
 *   pill, and may-pass; and the end note with a detail and without. The words
 *   are samples, as the server would resolve them.
 */

import type { EndView } from "@krapht/ork-server/client";

import { EndBadge } from "../components/end-badge.tsx";
import { EndNote } from "../components/end-note.tsx";
import { Section } from "./section.tsx";

const sample = (
  actor: NonNullable<EndView["actor"]>,
  label: string,
  over: Partial<EndView> = {},
): EndView => ({
  kind: label.toLowerCase().replaceAll(" ", "_"),
  message: `ended: ${label.toLowerCase()}`,
  label,
  actor,
  transient: false,
  hint: "",
  docsAnchor: label.toLowerCase().replaceAll(" ", "-"),
  ...over,
});

const ENDS: EndView[] = [
  sample("agent", "No report"),
  sample("workflow", "Turn limit"),
  sample("account", "Out of credits"),
  sample("provider", "Rate limited", { transient: true }),
  sample("user", "Interrupted"),
  sample("ork", "Unknown"),
];

const WITH_DETAIL = sample("provider", "Provider unavailable", {
  message: "could not reach its provider, or the provider was overloaded",
  transient: true,
  hint: "This may pass: resuming the run tries again.",
  detail: '{"type":"error","error":{"type":"overloaded_error"}}',
});

const WITHOUT_DETAIL = sample("workflow", "Turn limit", {
  message: "reached its turn limit (8)",
  hint: "Raise its `maxTurns`, or give it a smaller task.",
});

export const Ends = () => (
  <>
    <Section title="Node end">
      {ENDS.map(end => (
        <EndBadge
          end={end}
          key={end.kind}
        />
      ))}
    </Section>
    <Section title="Node end, as a pill">
      {ENDS.map(end => (
        <EndBadge
          end={end}
          key={end.kind}
          pill
        />
      ))}
    </Section>
    <Section title="Node end note, with details">
      <EndNote
        end={WITH_DETAIL}
        node="build"
        runId="aaa11111"
      />
    </Section>
    <Section title="Node end note, without details">
      <EndNote
        end={WITHOUT_DETAIL}
        node="build"
        runId="aaa11111"
      />
    </Section>
  </>
);
