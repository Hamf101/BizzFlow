import { ChevronRight, FileText } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import type { ReactElement } from "react"

import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { AuthPageCard } from "@/lib/page-auth-card"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { listGuestDocuments } from "@/services/document-service"

export const metadata: Metadata = { title: "Shared with you" }

const LINK = "text-sm font-medium text-primary underline-offset-4 hover:underline"

/**
 * Home for someone given documents from outside a workspace: each document
 * shared with them, and the way to a workspace of their own.
 */
export default async function SharedWithYouPage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/shared")
  const [documents, { context }] = await Promise.all([
    listGuestDocuments(user.id),
    loadPageOrganizationContext({ userId: user.id, failureEvent: "shared_with_you_context_load_failed" }),
  ])

  return (
    <AuthPageCard
      description={documents.length ? `Documents people shared with ${user.email ?? "you"}.` : "Nothing is shared with you right now."}
      footer={
        context ? (
          <Link className={LINK} href="/dashboard">
            Back to {context.organization.name}
          </Link>
        ) : (
          <Link className={LINK} href="/welcome">
            Create your own workspace
          </Link>
        )
      }
      footerClassName="justify-center"
      title="Shared with you"
    >
      {documents.length ? (
        <ul className="-mx-2 flex flex-col">
          {documents.map((document) => (
            <li key={document.documentId}>
              <Link
                className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href={`/documents/${encodeURIComponent(document.documentId)}/preview`}
              >
                <FileText aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{document.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {document.organizationName} · {document.accessLevel === "contributor" ? "Editor" : "Viewer"}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : undefined}
    </AuthPageCard>
  )
}
