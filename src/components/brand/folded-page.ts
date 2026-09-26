/**
 * The BizFlow page with its corner folded, cut into facets: the sign-in
 * backdrop builds it step by step, and Flow's button is the same page, small.
 * Points are in the page's own units, 360 wide and 460 tall about its middle.
 */
export type Point = readonly [number, number]

type Corner = keyof typeof CORNERS

export type Tone = "lavender" | "lilac" | "wisteria" | "orchid" | "periwinkle" | "rose" | "sage"

export const CORNERS = {
  c1: [-40, -60],
  c2: [60, 40],
  c3: [-90, 120],
  c4: [100, -60],
  m1: [-180, 0],
  m2: [0, 230],
  m3: [180, 60],
  m4: [-40, -230],
  p1: [90, -230],
  p2: [180, -140],
  p3: [180, 230],
  p4: [-180, 230],
  tl: [-180, -230],
} as const

// Each facet arrives at a step and, once the page is whole, drifts through its
// three tones. Mostly purples, with a little rose and sage.
export const FACETS: ReadonlyArray<{ at: number; corners: [Corner, Corner, Corner]; strength: number; tones: [Tone, Tone, Tone] }> = [
  { at: 1, corners: ["p1", "p2", "c4"], strength: 0.9, tones: ["lilac", "orchid", "lavender"] },
  { at: 2, corners: ["m4", "p1", "c1"], strength: 0.7, tones: ["lavender", "periwinkle", "lilac"] },
  { at: 2, corners: ["p1", "c4", "c1"], strength: 0.85, tones: ["wisteria", "lilac", "orchid"] },
  { at: 2, corners: ["tl", "m4", "c1"], strength: 0.6, tones: ["orchid", "rose", "lavender"] },
  { at: 2, corners: ["p2", "m3", "c4"], strength: 0.75, tones: ["periwinkle", "lavender", "wisteria"] },
  { at: 3, corners: ["c4", "m3", "c2"], strength: 0.65, tones: ["lilac", "wisteria", "periwinkle"] },
  { at: 3, corners: ["c1", "c4", "c2"], strength: 0.5, tones: ["rose", "orchid", "lavender"] },
  { at: 3, corners: ["tl", "c1", "m1"], strength: 0.8, tones: ["lavender", "lilac", "orchid"] },
  { at: 3, corners: ["m1", "c1", "c3"], strength: 0.6, tones: ["wisteria", "periwinkle", "lilac"] },
  { at: 3, corners: ["c1", "c2", "c3"], strength: 0.85, tones: ["orchid", "lavender", "rose"] },
  { at: 3, corners: ["m1", "c3", "p4"], strength: 0.55, tones: ["lilac", "wisteria", "lavender"] },
  { at: 3, corners: ["c3", "m2", "p4"], strength: 0.7, tones: ["rose", "orchid", "lilac"] },
  { at: 3, corners: ["c3", "c2", "m2"], strength: 0.9, tones: ["lavender", "lilac", "sage"] },
  { at: 3, corners: ["c2", "m3", "p3"], strength: 0.6, tones: ["periwinkle", "wisteria", "lilac"] },
  { at: 3, corners: ["c2", "p3", "m2"], strength: 0.75, tones: ["sage", "lavender", "periwinkle"] },
]

export const FLAP: [Point, Point, Point] = [[90, -230], [90, -140], [180, -140]]
export const WAVES = [-20, 70]
