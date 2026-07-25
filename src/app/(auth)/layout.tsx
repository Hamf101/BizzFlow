import type { Metadata } from "next"

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[38%] h-[360px] w-[600px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in oklch, var(--primary) 22%, transparent), transparent 62%)",
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-[30%] w-px bg-border/60"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-[30%] w-px bg-border/60"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[22%] h-px bg-border/45"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[22%] h-px bg-border/45"
      />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      {children}
    </main>
  )
}
