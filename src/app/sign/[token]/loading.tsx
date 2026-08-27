import type { ReactElement } from "react"

import { PublicPageSkeleton } from "@/components/public/public-page-skeleton"

export default function PublicSigningLoading(): ReactElement {
  return <PublicPageSkeleton variant="wide" />
}
