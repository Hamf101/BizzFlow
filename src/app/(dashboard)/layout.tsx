import * as Sentry from "@sentry/nextjs"
import { redirect } from "next/navigation"
import { Suspense, type ReactElement, type ReactNode } from "react"

import { PostHogProvider } from "@/components/analytics/posthog-provider"
import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-content-skeleton"
import type { DashboardAccount } from "@/components/navigation/dashboard-account-menu"
import { DashboardSidebar } from "@/components/navigation/dashboard-sidebar"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { createClient } from "@/lib/supabase/server"
import {
  getCurrentOrganizationContext,
  getMemberSettings,
} from "@/services/organization-service"

export const dynamic = "force-dynamic"

async function signOutAction(): Promise<void> {
  "use server"

  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

/**
 * Attaches the signed-in member to the request's error-reporting scope.
 *
 * Renders nothing and never redirects: `src/lib/supabase/proxy.ts` already
 * bounces unauthenticated and unconfigured requests for every protected prefix,
 * and each page resolves the member itself. Awaiting auth in the layout body
 * instead would block the entire shell on a round trip the proxy already made.
 *
 * @returns Nothing; this component exists only for its scope side effect.
 */
async function DashboardUserScope(): Promise<null> {
  try {
    const user = await getAuthenticatedUser()
    Sentry.setUser({ id: user.id })
  } catch (error: unknown) {
    if (!(error instanceof AuthenticationError)) {
      console.error("dashboard_layout_configuration_failed", {
        reason:
          error instanceof Error ? error.message : "Unknown configuration error",
      })
      captureUnexpectedError(error, { boundary: "dashboard_layout" })
    }
  }

  return null
}

/**
 * Produces the best available name when a member has not completed their profile.
 *
 * @param email - Authenticated email address, when Supabase supplied one.
 * @returns A readable account label.
 */
function getFallbackDisplayName(email: string | null): string {
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

/**
 * Loads account details used by the persistent dashboard sidebar.
 *
 * @param user - The authenticated dashboard member.
 * @returns Profile, organization, and role details with resilient fallbacks.
 */
async function getDashboardAccount(
  user: Awaited<ReturnType<typeof getAuthenticatedUser>>
): Promise<DashboardAccount> {
  const fallbackAccount: DashboardAccount = {
    displayName: getFallbackDisplayName(user.email),
    email: user.email ?? "Email unavailable",
    organizationName: null,
    role: null,
  }

  try {
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return fallbackAccount
    }

    const settings = await getMemberSettings({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })

    return {
      displayName: settings.displayName?.trim() || fallbackAccount.displayName,
      email: fallbackAccount.email,
      organizationName: context.organization.name,
      role: context.membership.role,
    }
  } catch (error: unknown) {
    console.warn("dashboard_account_load_failed", {
      reason: error instanceof Error ? error.message : "Unknown account error",
      userId: user.id,
    })
    return fallbackAccount
  }
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode
}>): Promise<ReactElement> {
  let account: DashboardAccount = {
    displayName: "BizFlow member",
    email: "Email unavailable",
    organizationName: null,
    role: null,
  }
  let userId: string | undefined
  try {
    const user = await getAuthenticatedUser()
    userId = user.id
    account = await getDashboardAccount(user)
  } catch {
    // Missing/invalid session handled by proxy or scope
  }

  return (
    <PostHogProvider userId={userId}>
      <div className="min-h-screen bg-canvas text-foreground">
        <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col md:flex-row">
          <DashboardSidebar account={account} signOutAction={signOutAction} />
          <div className="min-w-0 flex-1 p-3 md:py-4 md:pr-4 md:pl-1">
            <main className="flex min-h-full flex-col rounded-[18px] border border-border/70 bg-background shadow-[0_1px_2px_rgba(37,35,41,0.04)]">
              <div className="min-w-0 flex-1 px-5 py-6 sm:px-7 sm:py-7">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <DashboardUserScope />
                  {children}
                </Suspense>
              </div>
            </main>
          </div>
        </div>
      </div>
    </PostHogProvider>
  )
}
