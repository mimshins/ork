/**
 * @file `claim` and `release`: a session's side of the run's claims. A node
 *   claims a file, folder or other resource before changing it, so nodes
 *   running at the same time do not change the same thing; a refused claim says
 *   who holds it. Only sessions that may write while another does get them.
 */

import { z } from "zod";

import { defineTool, text, type ToolContext } from "./tool.ts";

const contended = ({ ports }: ToolContext): boolean =>
  ports.claims?.contended() === true;

const resource = z
  .string()
  .min(1)
  .describe(
    "A path from the project root (a folder covers everything in it), or a name for something else shared, e.g. 'db:migrations'.",
  );

export const claimTool = defineTool({
  name: "claim",
  description:
    "Claim a file, folder or other shared resource before you change it, so other nodes running in this run leave it alone. If another node holds it (or something overlapping), you are told who; Ork tells you when it is released.",
  shape: { resource },
  available: contended,
  run: ({ ports }, args) => {
    const claimed = ports.claims?.claim(args.resource);
    if (claimed === undefined) return Promise.resolve(text("No claims."));
    if (!claimed.ok) {
      return Promise.resolve(text(`Not claimed: ${claimed.error}.`));
    }
    return Promise.resolve(
      text(
        claimed.already
          ? `You already hold ${claimed.resource}.`
          : `Claimed ${claimed.resource}.`,
      ),
    );
  },
});

export const releaseTool = defineTool({
  name: "release",
  description:
    "Release a claim you are done with, so other nodes can take it. Ork releases your remaining claims when you finish.",
  shape: { resource },
  available: contended,
  run: ({ ports }, args) => {
    const released = ports.claims?.release(args.resource);
    if (released === undefined) return Promise.resolve(text("No claims."));
    return Promise.resolve(
      text(
        released.ok
          ? `Released ${released.resource}.`
          : `Not released: ${released.error}.`,
      ),
    );
  },
});
