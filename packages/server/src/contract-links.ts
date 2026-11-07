/**
 * @file The routes that link two nodes of live runs (RFC-003): list, link and
 *   end a link. It imports only `zod`, so a browser bundle can use it.
 */

import { z } from "zod";

/** Two nodes of live runs, each `<run>/<node>` (RFC-003). */
export const LinkSchema = z.strictObject({
  a: z.string().min(3),
  b: z.string().min(3),
  maxMessages: z.number().int().positive().optional(),
});

export const UnlinkSchema = z.strictObject({
  a: z.string().min(3),
  b: z.string().min(3),
});

export const LinksQuerySchema = z.strictObject({
  run: z.string().min(1).optional(),
});

export const LINKS_API = {
  links: { method: "GET", path: "/api/links", query: LinksQuerySchema },
  link: { method: "POST", path: "/api/links", body: LinkSchema },
  unlink: { method: "POST", path: "/api/links/end", body: UnlinkSchema },
} as const;
