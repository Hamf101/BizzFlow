"use server"

import { redirect } from "next/navigation"
import { z } from "zod"

import { buildRedirect, getFormString } from "@/lib/form-utils"
import { createClient } from "@/lib/supabase/server"

const confirmSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["email", "signup"]),
})

/**
 * Confirms a new account's address from its emailed link and signs it in, in
 * whichever browser opened the link. The link's token is long and random, and
 * Supabase limits how often tokens are checked, so no limit of its own here.
 *
 * @param formData - The link's token and its type.
 * @returns Never returns; goes on to naming the workspace, or back to say the link is spent.
 */
export async function confirmEmailAction(formData: FormData): Promise<void> {
  const parsed = confirmSchema.safeParse({
    token_hash: getFormString(formData, "token_hash"),
    type: getFormString(formData, "type"),
  })

  if (!parsed.success) {
    redirect(buildRedirect("/confirm-email", { error: "expired" }))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp(parsed.data)

  if (error) {
    console.warn("confirm_email_rejected", { code: error.code ?? null, status: error.status ?? null })
    redirect(buildRedirect("/confirm-email", { error: "expired" }))
  }

  redirect("/welcome")
}
