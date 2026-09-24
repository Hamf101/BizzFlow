import { z } from "zod"

// A share of the free room across or down the canvas: 0 at one edge, 1 at the other.
const shareSchema = z.number().min(0).max(1)

/**
 * Where a person keeps the editor's floating tools. Each spot is held as
 * shares of the free canvas rather than pixels, so a tool stays in the same
 * place on any screen. Tools left where they started are not stored.
 */
export const editorLayoutSchema = z
  .object({
    dock: z
      .object({
        orientation: z.enum(["upright", "flat"]),
        x: shareSchema,
        y: shareSchema,
      })
      .strict()
      .optional(),
    zoom: z.object({ x: shareSchema, y: shareSchema }).strict().optional(),
  })
  .strict()

/** Where the dock and the zoom control sit, and which way the dock runs. */
export type EditorLayout = z.infer<typeof editorLayoutSchema>
