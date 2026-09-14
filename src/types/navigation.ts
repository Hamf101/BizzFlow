import { z } from "zod"

/** Stable route identifiers; labels and order never change the destination. */
export const NAVIGATION_HREFS = ["/dashboard", "/people", "/documents", "/templates", "/submissions", "/tasks", "/audit-log", "/settings"] as const
export const navigationHrefSchema = z.enum(NAVIGATION_HREFS)
export const navigationLabelSchema = z.string().trim().min(1).max(40)
export const navigationOrderSchema = z.array(navigationHrefSchema).max(NAVIGATION_HREFS.length)
  .refine((order) => new Set(order).size === order.length, "Each tab may appear only once.")
export const renameNavigationSchema = z.object({
  href: navigationHrefSchema,
  label: navigationLabelSchema,
  expectedRevision: z.number().int().nonnegative(),
})

/** Shared workspace labels and the current member's saved order. */
export type NavigationPreferences = {
  labels: Partial<Record<(typeof NAVIGATION_HREFS)[number], string>>
  order: string[]
  revision: number
  canRename: boolean
}
