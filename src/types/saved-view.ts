import { z } from "zod"

/** Lists whose view menu can keep a member's views, named by their route. */
const SAVED_VIEW_LISTS = [
  "documents",
  "submissions",
  "tasks",
  "templates",
  "audit-log",
] as const

/** Longest query a view keeps; a list's own settings never come close. */
const SAVED_VIEW_QUERY_MAX_LENGTH = 1_000

/** Views one member keeps on one list. */
export const MAX_SAVED_VIEWS_PER_LIST = 20

export const savedViewListSchema = z.enum(SAVED_VIEW_LISTS)
export const savedViewNameSchema = z.string().trim().min(1).max(40)
export const savedViewIdSchema = z.string().uuid()

/** A view keeps a list's canonical settings, never which page was open. */
export const savedViewQuerySchema = z
  .string()
  .max(SAVED_VIEW_QUERY_MAX_LENGTH)
  .refine(
    (query: string): boolean =>
      !query.startsWith("?") && !new URLSearchParams(query).has("page"),
    "A saved view keeps a list's settings, not a page."
  )

export type SavedViewList = z.infer<typeof savedViewListSchema>

/** One of a member's saved views of a list. */
export type SavedView = {
  id: string
  list: SavedViewList
  name: string
  query: string
}

/** A saved view as the database keeps it. */
export type SavedViewRecord = SavedView & {
  created_at: string
  org_id: string
  updated_at: string
  user_id: string
}
