import { savedContentOf } from "@/lib/collaboration/working-copy-checks"
import type { TemplateContentV3 } from "@/types/template"

/**
 * The answers a document shows once Flow's fill comes back: what the server
 * now holds, except any the member changed while the fill was on its way,
 * which stay as they typed them and save after it.
 *
 * @param before - The answers when the fill left, all of them saved.
 * @param current - The answers on the page now.
 * @param filled - The answers the server holds after the fill.
 * @returns The answers to show.
 */
export function mergeFilledAnswers(
  before: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  filled: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...filled }

  for (const key of new Set([...Object.keys(before), ...Object.keys(current)])) {
    // An answer kept as it was is the same value, so a changed one is a new one.
    if (current[key] === before[key]) continue

    if (current[key] === undefined) {
      delete merged[key]
    } else {
      merged[key] = current[key]
    }
  }

  return merged
}

const PROBLEMS = "Fix the problems on the page first."

/**
 * Why a form's answers can't be filled in yet, or null when they can. The
 * fields the answers go in must reach the server first, so a page that
 * wouldn't save as it stands is refused, and so are changes the member keeps
 * on this device until they choose to save.
 *
 * @param page - The page and its title, as the editor holds them.
 * @param state - What the editor knows: checks still loading, problems that block saving, and changes it won't save on its own.
 * @returns The reason, or null.
 */
export function whyNotFill(
  page: Readonly<{ content: TemplateContentV3; title: string }>,
  state: Readonly<{ checking?: boolean; problems?: number; unsavedByChoice?: boolean }> = {}
): string | null {
  if (state.checking) {
    return "Checking the template. Try again in a moment."
  }

  if ((state.problems ?? 0) > 0 || !page.title.trim() || savedContentOf(page.content) === null) {
    return PROBLEMS
  }

  return state.unsavedByChoice ? "Save your changes first." : null
}
