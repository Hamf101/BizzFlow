import type { Metadata } from "next";
import "./globals.css";

import { OfflineDraftBanner } from "@/components/ui/offline-draft-banner";
import { BizFlowToaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: {
    default: "BizFlow Document Studio",
    template: "%s · BizFlow",
  },
  description:
    "Create, organize, sign, and review accountable business documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <OfflineDraftBanner />
          <BizFlowToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
