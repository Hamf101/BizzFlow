/**
 * Produces the best available name when a member has not completed their profile.
 *
 * @param email - Authenticated email address, when Supabase supplied one.
 * @returns A readable account label.
 */
export function getFallbackDisplayName(email: string | null): string {
  if (!email) {
    return "BizFlow member"
  }

  const localPart = email.split("@", 1)[0] ?? ""
  const words = localPart.split(/[._-]+/).filter(Boolean)

  if (words.length === 0) {
    return email
  }

  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}
