import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

async function signOutAction(): Promise<void> {
  "use server"

  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode
}>): Promise<ReactElement> {
  let supabase: Awaited<ReturnType<typeof createClient>>

  try {
    supabase = await createClient()
  } catch {
    redirect("/login?error=Supabase%20environment%20is%20not%20configured.")
  }

  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">BizFlow Docs</span>
              <Badge variant="secondary">Sprint 4</Badge>
            </div>
            <span className="text-sm text-muted-foreground">
              Document workspace for folders, uploads, and review workflows.
            </span>
          </div>
          <form action={signOutAction}>
            <Button variant="outline" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-3 text-sm">
          <span className="font-medium">Navigation</span>
          <Separator />
          <nav className="flex flex-col gap-2 text-muted-foreground">
            <Link className="font-medium text-foreground" href="/dashboard">
              Dashboard
            </Link>
            <Link className="hover:text-foreground" href="/people">
              People
            </Link>
            <Link className="hover:text-foreground" href="/audit-log">
              Audit Log
            </Link>
            <Link className="hover:text-foreground" href="/documents">
              Documents
            </Link>
            <span>Templates</span>
            <span>Submissions</span>
            <span>Tasks</span>
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  )
}
