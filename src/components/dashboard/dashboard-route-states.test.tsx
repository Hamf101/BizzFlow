// @vitest-environment node

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const DASHBOARD_LOADING_FILES = [
  "src/app/(dashboard)/loading.tsx",
  "src/app/(dashboard)/dashboard/loading.tsx",
  "src/app/(dashboard)/documents/loading.tsx",
  "src/app/(dashboard)/templates/loading.tsx",
  "src/app/(dashboard)/submissions/loading.tsx",
  "src/app/(dashboard)/tasks/loading.tsx",
  "src/app/(dashboard)/people/loading.tsx",
  "src/app/(dashboard)/audit-log/loading.tsx",
  "src/app/(dashboard)/settings/loading.tsx",
] as const

describe("authenticated route transitions", () => {
  it("does not install loading screens between dashboard destinations", () => {
    const existingLoadingFiles = DASHBOARD_LOADING_FILES.filter((file) =>
      existsSync(resolve(process.cwd(), file))
    )

    expect(existingLoadingFiles).toEqual([])
  })
})
