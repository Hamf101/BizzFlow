import { z } from "zod"

/** What a new password needs, each in the words shown beside the field. */
export const PASSWORD_RULES: ReadonlyArray<{ hint: string; met: (password: string) => boolean }> = [
  { hint: "8 or more characters", met: (password) => password.length >= 8 },
  { hint: "An uppercase letter", met: (password) => /\p{Lu}/u.test(password) },
  { hint: "A lowercase letter", met: (password) => /\p{Ll}/u.test(password) },
  { hint: "A number", met: (password) => /\p{N}/u.test(password) },
  { hint: "A symbol, like ! @ #", met: (password) => /[^\p{L}\p{N}\s]/u.test(password) },
]

/** A new password typed twice: it meets every rule, and the two match. */
export const newPasswordSchema = z
  .object({ confirm: z.string(), password: z.string() })
  .refine(({ password }) => PASSWORD_RULES.every((rule) => rule.met(password)), {
    message: "Choose a password with 8 or more characters, an uppercase and a lowercase letter, a number and a symbol.",
    path: ["password"],
  })
  .refine(({ confirm, password }) => confirm === password, {
    message: "The two passwords don't match.",
    path: ["confirm"],
  })
