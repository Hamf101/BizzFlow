import { Suspense, type ReactElement, type ReactNode } from "react"

import { ActionFeedback } from "@/components/ui/action-feedback"

export const dynamic = "force-dynamic"

/**
 * The editor's own screen, apart from the dashboard: no sidebar and no tab
 * bar, only the document. Sign-in is enforced by the proxy for these paths,
 * and each page resolves the member itself.
 *
 * @param props - The editor page.
 * @returns The page, with feedback from redirects shown as toasts.
 */
export default function EditorLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <>
      <Suspense fallback={null}>
        <ActionFeedback />
      </Suspense>
      {children}
    </>
  )
}
