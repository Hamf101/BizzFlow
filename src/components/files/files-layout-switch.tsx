import { Columns3, GalleryThumbnails, LayoutGrid, List } from "lucide-react"
import type { ComponentType, ReactElement } from "react"

import { FILES_LAYOUTS, type FilesLayout } from "@/components/files/file-list-view"
import { cn } from "@/lib/utils"

const LAYOUT_LOOKS: Record<
  FilesLayout,
  { icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>; label: string }
> = {
  columns: { icon: Columns3, label: "Columns" },
  gallery: { icon: GalleryThumbnails, label: "Gallery" },
  icons: { icon: LayoutGrid, label: "Icons" },
  list: { icon: List, label: "List" },
}

/** Columns and Gallery need width, so narrower screens offer Icons and List. */
function needsWidth(layout: FilesLayout): boolean {
  return layout === "columns" || layout === "gallery"
}

/**
 * Switches between Finder's four views. Each press posts the choice, which is
 * remembered for the person, and comes back to the same folder and item.
 *
 * @param props - The action that remembers the choice, the current layout,
 *   and the Files address to return to.
 * @returns The four-way layout switch.
 */
export function FilesLayoutSwitch({
  action,
  current,
  returnTo,
}: {
  action: (formData: FormData) => Promise<void>
  current: FilesLayout
  returnTo: string
}): ReactElement {
  return (
    <form action={action} className="shrink-0" data-slot="files-layout-switch">
      <input name="returnTo" type="hidden" value={returnTo} />
      <div
        aria-label="Layout"
        className="inline-flex rounded-[9px] border border-border bg-card p-0.5"
        role="group"
      >
        {FILES_LAYOUTS.map((layout: FilesLayout) => {
          const { icon: Icon, label } = LAYOUT_LOOKS[layout]

          return (
            <button
              aria-label={`${label} view`}
              aria-pressed={layout === current}
              className={cn(
                "grid h-[26px] w-[30px] place-items-center rounded-[7px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
                layout === current && "bg-secondary text-secondary-foreground",
                needsWidth(layout) && "max-lg:hidden",
                // Where Columns or Gallery cannot fit, Icons stands in for them.
                layout === "icons" &&
                  needsWidth(current) &&
                  "max-lg:bg-secondary max-lg:text-secondary-foreground"
              )}
              key={layout}
              name="layout"
              title={`${label} view`}
              type="submit"
              value={layout}
            >
              <Icon aria-hidden className="size-[15px]" />
            </button>
          )
        })}
      </div>
    </form>
  )
}
