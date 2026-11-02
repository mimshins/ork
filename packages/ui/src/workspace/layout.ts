/**
 * @file The layout a browser remembers: dockview's own description of the dock,
 *   the panels minimized to the rail with where each came from, and the panels
 *   folded in the narrow stack. A saved layout is checked before it is used,
 *   since it may come from an older Ork or be damaged; one that fails is
 *   dropped for the default.
 */

import { PersistentContainer } from "containerized-state-plugin-persistence";
import type { SerializedDockview } from "dockview-react";
import { z } from "zod";

import { isPanelId, type PanelId } from "./panels.tsx";

const LAYOUT_KEY = "ork.layout.v1";

const PanelIdSchema = z.custom<PanelId>(
  value => typeof value === "string" && isPanelId(value),
);

const BoxSchema = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});

export type FloatBox = z.infer<typeof BoxSchema>;

/** Where a panel was, for putting it back. */
const AnchorSchema = z.object({
  group: z.string(),
  index: z.number(),
  floating: BoxSchema.optional(),
  beside: z
    .object({
      // The group it was beside; null when it had a workspace edge to itself.
      group: z.string().nullable(),
      direction: z.enum(["left", "right", "above", "below"]),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export type Anchor = z.infer<typeof AnchorSchema>;

const MinimizedSchema = z.object({ id: PanelIdSchema, anchor: AnchorSchema });

export type Minimized = z.infer<typeof MinimizedSchema>;

const DockSchema = z.looseObject({
  grid: z.looseObject({ root: z.looseObject({}) }),
  panels: z.record(
    z.string(),
    z.looseObject({ contentComponent: PanelIdSchema }),
  ),
});

const SavedSchema = z.object({
  dock: z.unknown(),
  minimized: z.array(MinimizedSchema),
  folded: z.array(PanelIdSchema),
});

export type SavedLayout = {
  /** Dockview's description of the dock; null until one has been saved. */
  dock: SerializedDockview | null;
  minimized: readonly Minimized[];
  /** The panels folded in the narrow stack. */
  folded: readonly PanelId[];
};

/** The folded panels with one more, or one fewer. */
export const withFold = (
  folded: readonly PanelId[],
  id: PanelId,
  fold: boolean,
): readonly PanelId[] => [
  ...folded.filter(other => other !== id),
  ...(fold ? [id] : []),
];

export const EMPTY_LAYOUT: SavedLayout = {
  dock: null,
  minimized: [],
  folded: [],
};

const isDock = (dock: unknown): dock is SerializedDockview =>
  DockSchema.safeParse(dock).success;

/** A saved value as a usable layout, or null when it cannot be trusted. */
export const readLayout = (saved: unknown): SavedLayout | null => {
  const parsed = SavedSchema.safeParse(saved);
  if (!parsed.success) return null;
  const { dock, minimized, folded } = parsed.data;
  if (dock === null || dock === undefined) {
    return { dock: null, minimized: [], folded };
  }
  if (!isDock(dock)) return null;
  // A panel cannot be both in the dock and on the rail: the dock wins.
  const docked = new Set(
    Object.values(dock.panels).map(panel => panel.contentComponent),
  );
  return {
    dock,
    minimized: minimized.filter(panel => !docked.has(panel.id)),
    folded,
  };
};

export const createLayoutStore = (
  storage: Storage,
): PersistentContainer<SavedLayout> =>
  new PersistentContainer<SavedLayout>(EMPTY_LAYOUT, {
    key: LAYOUT_KEY,
    storage,
  });
