import * as Sentry from "@sentry/nextjs"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense, type ReactElement, type ReactNode } from "react"

import { BizFlowWordmark } from "@/components/brand/bizflow-mark"
import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-content-skeleton"
import { DashboardNavigation } from "@/components/navigation/dashboard-navigation"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Button } from "@/components/ui/button"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { createClient } from "@/lib/supabase/server"

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

export default function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode
}>): ReactElement {
  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col md:flex-row">
        <aside className="flex flex-col gap-6 px-4 pt-5 pb-4 md:w-[232px] md:shrink-0 md:pt-6">
          <Link
            aria-label="BizFlow dashboard"
            className="inline-flex w-fit rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            href="/dashboard"
          >
            <BizFlowWordmark />
          </Link>
          <div className="hidden md:block">
            <span className="editorial-kicker text-muted-foreground">
              Workspace
            </span>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Structured documents with a visible history.
            </p>
          </div>
          <DashboardNavigation />
          <div className="mt-auto hidden border-t border-border/70 pt-4 text-xs text-muted-foreground md:block">
            <Link className="hover:text-foreground" href="/templates">
              Start from a template →
            </Link>
          </div>
        </aside>
        <div className="min-w-0 flex-1 p-3 md:py-4 md:pr-4 md:pl-1">
          <main className="flex min-h-full flex-col rounded-[18px] border border-border/70 bg-background shadow-[0_1px_2px_rgba(37,35,41,0.04)]">
            <header className="flex items-center justify-end gap-2 border-b border-border/70 px-5 py-3 sm:px-7">
              <ThemeToggle />
              <form action={signOutAction}>
                <Button size="sm" variant="outline" type="submit">
                  Sign out
                </Button>
              </form>
            </header>
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
  )
}
