"use client"

import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"

import { shownSize } from "@/components/pdf-signing/pdf-tones"
import { cn } from "@/lib/utils"
import type { PdfPage } from "@/services/pdf-signing-service"

// pdf.js reads the file in a worker served from this site, which the CSP allows ('self').
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

const MAX_WIDTH = 820

/**
 * Shows an uploaded PDF page by page, as wide as there is room for, with
 * whatever goes over each page laid exactly on it. Each page keeps its shape
 * before it is drawn, so nothing moves as pages arrive.
 *
 * @param props - Where the PDF is read from, its pages as stored, and what goes over each page.
 * @returns The pages.
 */
export function PdfPages({
  className,
  file,
  overlay,
  pages,
}: {
  className?: string
  file: string
  overlay: (pageNumber: number) => ReactNode
  pages: readonly PdfPage[]
}): ReactElement {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = frame.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.min(MAX_WIDTH, Math.floor(entry?.contentRect.width ?? 0))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={cn("w-full", className)} ref={frame}>
      {failed ? (
        <p className="py-10 text-center text-sm text-muted-foreground" role="alert">
          This PDF couldn&apos;t be shown. Reload the page to try again.
        </p>
      ) : (
        <Document file={file} loading={null} onLoadError={() => setFailed(true)}>
          {/* ponytail: every page draws at once; draw pages near the screen only if long PDFs drag. */}
          <ol className="mx-auto flex flex-col items-center gap-4" style={{ maxWidth: MAX_WIDTH }}>
            {pages.map((page, index) => {
              const shown = shownSize(page)

              return (
                <li
                  aria-label={`Page ${index + 1} of ${pages.length}`}
                  className="relative w-full overflow-hidden rounded-xs bg-card shadow-[0_1px_2px_rgba(37,35,41,0.08),0_8px_18px_rgba(37,35,41,0.08)]"
                  data-document-surface="paper"
                  data-page={index + 1}
                  key={index}
                  style={{ aspectRatio: `${shown.width} / ${shown.height}` }}
                >
                  {width > 0 ? (
                    <Page loading={null} pageNumber={index + 1} renderAnnotationLayer={false} renderTextLayer={false} width={width} />
                  ) : null}
                  <div className="absolute inset-0">{overlay(index + 1)}</div>
                </li>
              )
            })}
          </ol>
        </Document>
      )}
    </div>
  )
}
