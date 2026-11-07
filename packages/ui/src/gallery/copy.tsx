/**
 * @file The gallery's pieces of copy: the key hint, a command as a code block
 *   with its copy button, a name as inline code, and the empty state with its
 *   next step's command.
 */

import { EmptyState } from "../components/bits.tsx";
import { CopyCommand } from "../components/copy-command.tsx";
import { Kbd } from "../components/kbd.tsx";
import { Section } from "./section.tsx";

export const Copy = () => (
  <>
    <Section title="Copy">
      <Kbd keys={["⌘", "K"]} />
      <p>To follow its log:</p>
      <CopyCommand command="ork logs 4f2a1c --follow" />
      <p>
        A <a href="#link">link</a> and <code>4f2a1c</code>.
      </p>
    </Section>
    <Section title="Empty state">
      <EmptyState
        cli="ork run <workflow>"
        title="No runs yet."
      >
        Start one with Run workflow, or in a terminal:
      </EmptyState>
    </Section>
  </>
);
