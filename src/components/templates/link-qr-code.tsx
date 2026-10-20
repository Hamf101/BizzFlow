"use client"

import { Download, QrCode } from "lucide-react"
import { type ReactElement, useMemo, useState } from "react"
import { encode } from "uqr"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Draws a QR code as one SVG path, dark on white whatever the theme, since
 * that is what a phone's camera reads.
 *
 * @param url - What the code opens.
 * @returns The SVG's markup.
 */
export function qrSvg(url: string): string {
  const { data, size } = encode(url, { border: 2, ecc: "M" })
  // One horizontal run per stretch of dark modules keeps the path short.
  const runs = data.flatMap((row, y) => {
    const found: string[] = []

    for (let x = 0; x < size; x += 1) {
      if (!row[x]) {
        continue
      }

      const start = x

      while (row[x + 1]) {
        x += 1
      }

      found.push(`M${start} ${y}h${x - start + 1}v1h-${x - start + 1}z`)
    }

    return found
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${runs.join("")}"/></svg>`
}

/**
 * A button that shows a link's QR code, to print for a counter or a poster,
 * and saves it as an SVG that stays sharp at any size.
 *
 * @param props - The link's full address and the name its file is saved under.
 * @returns The button and its dialog.
 */
export function LinkQrCode({ name, url }: { name: string; url: string }): ReactElement {
  const [open, setOpen] = useState(false)
  const svg = useMemo(() => (open ? qrSvg(url) : ""), [open, url])
  const file = `${name.replace(/[^\w -]+/g, "").trim() || "public-link"} QR code.svg`

  return (
    <>
      <Button aria-label={`Show the QR code for ${name}`} onClick={() => setOpen(true)} size="sm" variant="ghost">
        <QrCode className="size-3.5" />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>Scanning it opens the form, no account needed.</DialogDescription>
          </DialogHeader>
          {/* Built here from the link alone, so nothing outside it reaches the markup. */}
          <div className="mx-auto w-56 overflow-hidden rounded-lg border" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR code for ${name}`} />
          <Button
            className="w-full"
            onClick={() => {
              const anchor = document.createElement("a")
              anchor.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
              anchor.download = file
              anchor.click()
              URL.revokeObjectURL(anchor.href)
            }}
            variant="outline"
          >
            <Download className="size-4" />
            Download
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
