import { NavigationPreferencesProvider } from "@/components/navigation/navigation-preferences-provider"
import { getNavigationPreferences } from "@/services/navigation-service"
import * as Sentry from "@sentry/nextjs"
import { redirect } from "next/navigation"
import { Suspense, type ReactElement, type ReactNode } from "react"

import { PostHogProvider } from "@/components/analytics/posthog-provider"
import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-content-skeleton"
import { FlowLauncher } from "@/components/flow/flow-launcher"
import type { DashboardAccount } from "@/components/navigation/dashboard-account-menu"
import { MobileTabBar } from "@/components/navigation/mobile-tab-bar"
import { MobileTopBar } from "@/components/navigation/mobile-top-bar"
import { DashboardSidebar } from "@/components/navigation/dashboard-sidebar"
import { ActionFeedback } from "@/components/ui/action-feedback"
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
    permissionSubject: null,
    role: null,
  }

  try {
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      return fallbackAccount
    }

    // Both only need the organization, so the shell waits for one round trip
    // rather than three. Navigation keeps its own catch: a lost preference
    // leaves the default tabs, while a lost setting drops to the fallback.
    const [settings, preferences] = await Promise.all([
      getMemberSettings({
        actorUserId: user.id,
        organizationId: context.organization.id,
      }),
      getNavigationPreferences({ actorUserId: user.id, organizationId: context.organization.id }).catch((error: unknown) => {
        console.warn("dashboard_navigation_load_failed", { userId: user.id, organizationId: context.organization.id, reason: error instanceof Error ? error.message : "Unknown error" })
        return undefined
      }),
    ])

    return {
      navigation: preferences ? { organizationId: context.organization.id, preferences } : undefined,
      displayName: settings.displayName?.trim() || fallbackAccount.displayName,
      email: fallbackAccount.email,
      organizationName: context.organization.name,
      permissionSubject: context.membership,
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
    permissionSubject: null,
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
      <NavigationPreferencesProvider key={`${userId}:${account.navigation?.organizationId}`} organizationId={account.navigation?.organizationId} initialPreferences={account.navigation?.preferences}>
      <Suspense fallback={null}>
        <ActionFeedback />
      </Suspense>
      <div className="flex min-h-dvh flex-col bg-canvas text-foreground" data-ground="canvas">
        <MobileTopBar account={account} signOutAction={signOutAction} />
        <div className="flex w-full flex-1 flex-col md:flex-row">
          <DashboardSidebar account={account} signOutAction={signOutAction} />
          <div className="flex min-w-0 flex-1 flex-col px-3 pt-3 md:pt-4 md:pr-4 md:pl-1">
            <main className="flex flex-1 flex-col rounded-t-[18px] border-x border-t border-border/70 bg-background">
              <div className="min-w-0 flex-1 px-5 pt-6 pb-[calc(8.25rem+env(safe-area-inset-bottom))] sm:px-7 sm:pt-7 md:pb-20">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  <DashboardUserScope />
                  {children}
                </Suspense>
              </div>
            </main>
          </div>
        </div>
        <MobileTabBar role={account.permissionSubject} />
        {account.navigation?.organizationId ? <FlowLauncher /> : null}
      </div>
      </NavigationPreferencesProvider>
    </PostHogProvider>
  )
}
