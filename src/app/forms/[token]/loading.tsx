import type { ReactElement } from "react"

import { PublicPageSkeleton } from "@/components/public/public-page-skeleton"

export default function PublicFormLoading(): ReactElement {
  return <PublicPageSkeleton label="Loading form" variant="form" />
}
