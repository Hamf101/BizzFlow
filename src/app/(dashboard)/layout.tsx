import { NavigationPreferencesProvider } from "@/components/navigation/navigation-preferences-provider"
import { getNavigationPreferences } from "@/services/organizations/navigation-service"
import * as Sentry from "@sentry/nextjs"
import { redirect } from "next/navigation"
import { Suspense, type ReactElement, type ReactNode } from "react"

import { SharingNoticesListener } from "@/components/sharing/sharing-notices-listener"
import { PostHogProvider } from "@/components/analytics/posthog-provider"
import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-content-skeleton"
import { FlowLauncher } from "@/components/flow/flow-launcher"
import type { DashboardAccount } from "@/components/navigation/dashboard-account-menu"
import { MobileTabBar } from "@/components/navigation/mobile-tab-bar"
import { MobileTopBar } from "@/components/navigation/mobile-top-bar"
import { DashboardSidebar } from "@/components/navigation/dashboard-sidebar"
import { WorkspaceSearch } from "@/components/search/workspace-search"
import { ActionFeedback } from "@/components/ui/action-feedback"
import { TimeZoneCookie } from "@/components/ui/local-date"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getFallbackDisplayName } from "@/lib/display-name"
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
  // This device only; the person stays logged in everywhere else.
  await supabase.auth.signOut({ scope: "local" })
  redirect("/login")
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
      roleName: context.membership.roleName,
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
    // Attaches the member to the request's error-reporting scope.
    Sentry.setUser({ id: user.id })
    account = await getDashboardAccount(user)
  } catch (error: unknown) {
    // A missing session is the proxy's to bounce; anything else is configuration.
    if (!(error instanceof AuthenticationError)) {
      console.error("dashboard_layout_configuration_failed", {
        reason:
          error instanceof Error ? error.message : "Unknown configuration error",
      })
      captureUnexpectedError(error, { boundary: "dashboard_layout" })
    }
  }

  return (
    <PostHogProvider userId={userId}>
      <NavigationPreferencesProvider key={`${userId}:${account.navigation?.organizationId}`} organizationId={account.navigation?.organizationId} initialPreferences={account.navigation?.preferences}>
      <Suspense fallback={null}>
        <ActionFeedback />
      </Suspense>
      {/* Tells the dashboard the viewer's time zone, for its "yesterday". */}
      <TimeZoneCookie />
      <div className="flex min-h-dvh flex-col bg-canvas text-foreground" data-ground="canvas">
        {/* The sidebar has a dozen stops; this is the first, so a keyboard user can skip them. */}
        <a
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[70] focus-visible:rounded-lg focus-visible:bg-foreground focus-visible:px-4 focus-visible:py-2.5 focus-visible:text-sm focus-visible:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="#main-content"
        >
          Skip to content
        </a>
        <MobileTopBar account={account} signOutAction={signOutAction} />
        <div className="flex w-full flex-1 flex-col md:flex-row">
          <DashboardSidebar account={account} signOutAction={signOutAction} />
          <div className="flex min-w-0 flex-1 flex-col px-3 pt-3 md:pt-4 md:pr-4 md:pl-1">
            <main className="flex flex-1 flex-col rounded-t-xl border-x border-t border-border/70 bg-background outline-none" id="main-content" tabIndex={-1}>
              <div className="min-w-0 flex-1 px-5 pt-6 pb-[calc(8.25rem+env(safe-area-inset-bottom))] sm:px-7 sm:pt-7 md:pb-20">
                <Suspense fallback={<DashboardContentSkeleton />}>
                  {children}
                </Suspense>
              </div>
            </main>
          </div>
        </div>
        <MobileTabBar role={account.permissionSubject} />
        {account.navigation?.organizationId ? <FlowLauncher organizationId={account.navigation.organizationId} /> : null}
        {userId ? <SharingNoticesListener /> : null}
        {/* Beside the sidebar rather than in a boundary of its own, so its
            buttons never come alive before the search they open. */}
        {account.permissionSubject ? <WorkspaceSearch role={account.permissionSubject} /> : null}
      </div>
      </NavigationPreferencesProvider>
    </PostHogProvider>
  )
}
