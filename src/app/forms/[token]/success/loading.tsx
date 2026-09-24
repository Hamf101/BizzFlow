import type { ReactElement } from "react"

import { PublicPageSkeleton } from "@/components/public/public-page-skeleton"

export default function PublicFormSuccessLoading(): ReactElement {
  return <PublicPageSkeleton label="Loading confirmation" variant="card" />
}
