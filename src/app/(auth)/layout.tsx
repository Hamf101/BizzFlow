import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthBackdrop } from "@/components/auth/auth-backdrop"
import { ThemeToggle } from "@/components/theme/theme-toggle"

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  referrer: "no-referrer",
}

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10" data-ground="canvas">
      {/* Reads the address to know the step; nothing waits on it. */}
      <Suspense fallback={null}>
        <AuthBackdrop />
      </Suspense>
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      {children}
    </main>
  )
}
