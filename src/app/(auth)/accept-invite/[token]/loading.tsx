import type { ReactElement } from "react"

import { PublicPageSkeleton } from "@/components/public/public-page-skeleton"

export default function AcceptInviteLoading(): ReactElement {
  return <PublicPageSkeleton label="Loading invitation" variant="panel" />
}
