import type { ReactElement } from "react"

import { PublicPageSkeleton } from "@/components/public/public-page-skeleton"

export default function PublicSigningLoading(): ReactElement {
  return <PublicPageSkeleton label="Loading signing page" variant="wide" />
}
