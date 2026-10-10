import type { ReactElement } from "react"

/**
 * The editor's frame with a blank page, shown the moment a document or
 * template is opened, so the tap is answered while the server reads it.
 *
 * @returns The editor's placeholder.
 */
export default function EditorLoading(): ReactElement {
  return (
    <div
      aria-live="polite"
      className="flex h-dvh flex-col bg-canvas"
      data-slot="editor-loading"
      role="status"
    >
      <span className="sr-only">Opening</span>
      <div aria-hidden="true" className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-4">
        <span className="size-6 rounded-full bg-muted motion-safe:animate-pulse" />
        <span className="h-4 w-32 rounded-full bg-muted motion-safe:animate-pulse" />
      </div>
      <div aria-hidden="true" className="flex min-h-0 flex-1 justify-center overflow-hidden px-3 pt-4 sm:px-6 sm:pt-18">
        <div className="grid aspect-[595/842] w-full max-w-[736px] content-start gap-4 rounded-[3px] bg-card p-[8%] shadow-[0_1px_2px_rgba(37,35,41,0.08),0_8px_18px_rgba(37,35,41,0.08)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
          <span className="h-6 w-2/5 rounded-full bg-muted motion-safe:animate-pulse" />
          <span className="h-3 w-4/5 rounded-full bg-muted/70 motion-safe:animate-pulse" />
          <span className="h-3 w-3/5 rounded-full bg-muted/70 motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  )
}
