"use client"

import { UserPlus } from "lucide-react"
import dynamic from "next/dynamic"
import { type ReactElement, useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SharingResource } from "@/services/document-service"

// Opened from a button, so it loads when asked for.
const ShareDialog = dynamic(() => import("@/components/sharing/share-dialog").then((dialog) => dialog.ShareDialog))

/**
 * Share, on a page that shows one document: the dialog opens over it.
 *
 * @param props - The document, its name for the dialog, and whether only its icon shows.
 * @returns The button and, once asked for, the Share dialog.
 */
export function ShareButton({
  className,
  iconOnly = false,
  name,
  resource,
}: {
  className?: string
  iconOnly?: boolean
  name: string
  resource: SharingResource
}): ReactElement {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        aria-label={iconOnly ? "Share" : undefined}
        className={cn(iconOnly && "size-10 max-md:size-11", className)}
        onClick={() => setOpen(true)}
        size={iconOnly ? "icon" : "default"}
        title={iconOnly ? "Share" : undefined}
        type="button"
        variant={iconOnly ? "ghost" : "outline"}
      >
        <UserPlus />
        {iconOnly ? null : "Share…"}
      </Button>
      {open ? <ShareDialog name={name} onOpenChange={setOpen} open resources={[resource]} /> : null}
    </>
  )
}
