"use client"

import { Check, Copy } from "lucide-react"
import { useState, type ReactElement } from "react"

import { Button } from "@/components/ui/button"

/**
 * Copies a pending invite's accept link to the clipboard.
 *
 * Email delivery is convenient but not required: an invite token is valid on
 * its own, so a manager whose email provider is unconfigured can still onboard
 * someone by sending them this link over any channel.
 *
 * @param props - The invite path to resolve against the current origin.
 * @returns A copy control that confirms it copied.
 */
export function InviteLinkButton({ path }: { path: string }): ReactElement {
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    const url = new URL(path, window.location.origin).toString()

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard access can be denied; the adjacent link stays usable.
      window.prompt("Copy this invite link:", url)
    }
  }

  return (
    <Button onClick={handleCopy} size="sm" type="button" variant="outline">
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : "Copy invite link"}
    </Button>
  )
}
