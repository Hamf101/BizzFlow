"use client"

import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Creates a stable imperative handle for opening a preview from focus or press.
 *
 * @returns A Base UI preview-card handle.
 */
function createPreviewCardHandle(): ReturnType<
  typeof PreviewCardPrimitive.createHandle
> {
  return PreviewCardPrimitive.createHandle()
}

/**
 * Groups an on-demand preview and owns its open state.
 *
 * @param props - Base UI preview-card root properties.
 * @returns The preview-card context provider.
 */
function PreviewCard(
  props: PreviewCardPrimitive.Root.Props
): ReactElement {
  return <PreviewCardPrimitive.Root {...props} />
}

/**
 * Opens a preview through hover, keyboard focus, or press.
 *
 * @param props - Base UI preview-card trigger properties.
 * @returns The rendered preview trigger.
 */
function PreviewCardTrigger(
  props: PreviewCardPrimitive.Trigger.Props
): ReactElement {
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="preview-card-trigger"
      {...props}
    />
  )
}

/**
 * Renders a positioned, token-driven preview surface.
 *
 * @param props - Popup content and positioning properties.
 * @returns The portalled preview surface.
 */
function PreviewCardContent({
  align = "start",
  alignOffset = 0,
  children,
  className,
  side = "bottom",
  sideOffset = 10,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >): ReactElement {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "w-80 origin-(--transform-origin) rounded-[16px] bg-card p-5 text-card-foreground shadow-[0_18px_60px_rgba(37,35,41,0.18)] ring-1 ring-border/75 outline-none",
            "transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.985] data-ending-style:opacity-0 data-starting-style:scale-[0.985] data-starting-style:opacity-0 motion-reduce:transition-none",
            className
          )}
          data-slot="preview-card-content"
          {...props}
        >
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
}
