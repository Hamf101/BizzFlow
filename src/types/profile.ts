import { z } from "zod"

/**
 * A person's own name and phone number, as typed into a form. The phone is
 * optional; the spaces, dashes and brackets people write numbers with are
 * dropped, and what's left must carry its country code, as it is stored.
 */
export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(200, "Use 200 characters or fewer for your name."),
  phoneNumber: z
    .string()
    .transform((value) => value.replace(/[\s().-]/g, "") || null)
    .refine((value) => value === null || /^\+[1-9]\d{1,14}$/.test(value), "Start your phone number with + and the country code."),
})
