import { describe, expect, it } from "vitest"

import { newPasswordSchema } from "@/types/password"

describe("a new password", () => {
  it("is accepted when it meets every rule and is typed the same twice", () => {
    expect(newPasswordSchema.safeParse({ confirm: "Pl@nted-4-trees", password: "Pl@nted-4-trees" }).success).toBe(true)
  })

  it("is refused when it misses any one rule, with a message saying what it needs", () => {
    // Each misses exactly one: length, an uppercase letter, a lowercase letter, a number, a symbol.
    for (const password of ["Sh0rt!", "no-upper-c4se", "NO-LOWER-C4SE", "No-number-here", "N0symbolHere"]) {
      const result = newPasswordSchema.safeParse({ confirm: password, password })

      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toMatch(/an uppercase and a lowercase letter, a number and a symbol/)
    }
  })

  it("is refused when the two don't match", () => {
    const result = newPasswordSchema.safeParse({ confirm: "Pl@nted-4-tree", password: "Pl@nted-4-trees" })

    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["The two passwords don't match."])
  })
})
