import type { Metadata } from "next"

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      {children}
    </main>
  )
}
