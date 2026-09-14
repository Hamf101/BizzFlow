"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import { readApiErrorMessage } from "@/components/documents/document-upload-client"
import { cn } from "@/lib/utils"
import type { SubmissionPreview } from "@/services/submission-service"

// The document renderer is large, and only a pause on a title needs it.
const GeneratedDocumentContent = dynamic(
  () =>
    import("@/components/documents/generated-document-content").then(
      (loaded) => loaded.GeneratedDocumentContent
    ),
  { ssr: false }
)

/** How long the pointer rests on a title before its pages open. */
const OPEN_DELAY_MS = 700
/** Time to cross from the title onto the pages without them closing. */
const CLOSE_DELAY_MS = 150
/** On-screen width of a previewed page, wide enough to read. */
const PAGE_WIDTH = 440
/**
 * Width the document lays itself out at before it is zoomed down to the page.
 * It is narrower than print, so the words stay large enough to read.
 */
const DOCUMENT_WIDTH = 600
/** A4 proportions, the templates' default page, until the document reports its own. */
const DEFAULT_PAGE_RATIO = 842 / 595
/** Height of the arrows and page count under the page. */
const NAV_HEIGHT = 34
/** Space between the title and its pages. */
const TITLE_GAP = 24
/** Space kept between the pages and the window's edges. */
const EDGE = 16
/** Closest the notch comes to the page's top or bottom corner. */
const CARET_INSET = 14

/** Where the pages are pinned: beside the title and level with its row. */
type PreviewAnchor = {
  left: number
  rowMiddle: number
  rowTop: number
}

/**
 * Links a submission's title to its page and, once the pointer rests on it,
 * opens the submission's own pages beside it, readable and with nothing behind
 * them. While they are open the row keeps its highlight and a notch on the page
 * points at it, so it is always clear whose pages they are.
 *
 * Phones and pens have no resting pointer, so there a tap simply opens the
 * submission.
 *
 * @param props - The submission's link, tenant, identifier, and title.
 * @returns The title link and, while open, its floating pages.
 */
export function SubmissionTitlePreview({
  href,
  organizationId,
  submissionId,
  title,
}: {
  href: string
  organizationId: string
  submissionId: string
  title: string
}): ReactElement {
  const linkRef = useRef<HTMLAnchorElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)
  const request = useRef<Promise<SubmissionPreview> | null>(null)
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null)
  const [pageRatio, setPageRatio] = useState(DEFAULT_PAGE_RATIO)
  const [preview, setPreview] = useState<SubmissionPreview | null>(null)
  const [failed, setFailed] = useState(false)

  const clearTimers = useCallback((): void => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])

  const close = useCallback((): void => {
    clearTimers()
    setAnchor(null)
  }, [clearTimers])

  const open = useCallback((): void => {
    const link = linkRef.current

    if (!link) {
      return
    }

    setAnchor(anchorPreview(link))
    setFailed(false)
    // One request per title for as long as the list is on screen; a failed
    // one is forgotten so the next pause tries again.
    request.current ??= requestSubmissionPreview(organizationId, submissionId)
    request.current.then(setPreview, () => {
      request.current = null
      setFailed(true)
    })
  }, [organizationId, submissionId])

  const scheduleClose = useCallback((): void => {
    clearTimers()
    closeTimer.current = window.setTimeout(close, CLOSE_DELAY_MS)
  }, [clearTimers, close])

  useEffect(() => clearTimers, [clearTimers])

  // The row keeps its highlight while its pages are open, even once the
  // pointer has moved onto them.
  useEffect(() => {
    const row = linkRef.current?.closest<HTMLElement>(
      '[data-slot="submission-row"]'
    )

    if (!row || anchor === null) {
      return
    }

    row.dataset.previewing = "true"

    return () => {
      delete row.dataset.previewing
    }
  }, [anchor])

  useEffect(() => {
    if (anchor === null) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close()
      }
    }
    // The pages are pinned to the window, so they close rather than drift when
    // anything but their own page scrolls.
    const closeOnScroll = (event: Event): void => {
      const target = event.target

      if (!(target instanceof Node && panelRef.current?.contains(target))) {
        close()
      }
    }

    window.addEventListener("keydown", closeOnEscape)
    window.addEventListener("scroll", closeOnScroll, {
      capture: true,
      passive: true,
    })
    window.addEventListener("resize", close)

    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      window.removeEventListener("scroll", closeOnScroll, { capture: true })
      window.removeEventListener("resize", close)
    }
  }, [anchor, close])

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>): void {
    if (event.pointerType !== "mouse") {
      return
    }

    window.clearTimeout(closeTimer.current)

    if (anchor === null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(open, OPEN_DELAY_MS)
    }
  }

  let panel: ReactNode = null

  if (anchor !== null) {
    // Placed with the page's real height, so the arrows under it always stay
    // inside the window.
    const pageHeight = Math.round(PAGE_WIDTH * pageRatio)
    const top = Math.max(
      EDGE,
      Math.min(anchor.rowTop, window.innerHeight - pageHeight - NAV_HEIGHT - EDGE)
    )

    panel = createPortal(
      // A pointer-only glance at what the submission's own page shows in
      // full, so it stays out of the accessibility tree and tab order.
      <div
        aria-hidden="true"
        className="fixed z-50 grid justify-items-center gap-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2 motion-safe:duration-200"
        data-slot="submission-preview"
        onPointerEnter={() => window.clearTimeout(closeTimer.current)}
        onPointerLeave={scheduleClose}
        ref={panelRef}
        style={{ left: anchor.left, top }}
      >
        <PreviewPages
          caretTop={Math.min(
            pageHeight - CARET_INSET,
            Math.max(CARET_INSET, anchor.rowMiddle - top)
          )}
          failed={failed}
          onPageRatio={setPageRatio}
          pageHeight={pageHeight}
          preview={preview}
        />
      </div>,
      document.body
    )
  }

  return (
    <>
      <Link
        className={cn(
          "w-fit max-w-full truncate rounded-[6px] text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/35",
          anchor !== null && "text-primary"
        )}
        data-slot="submission-title"
        href={href}
        onClick={close}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={scheduleClose}
        ref={linkRef}
      >
        {title}
      </Link>
      {panel}
    </>
  )
}

function PreviewPages({
  caretTop,
  failed,
  onPageRatio,
  pageHeight,
  preview,
}: {
  caretTop: number
  failed: boolean
  onPageRatio: (ratio: number) => void
  pageHeight: number
  preview: SubmissionPreview | null
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)

  // Each page is a page-sized window onto the document, so they are counted
  // again whenever the document lays itself out.
  useEffect(() => {
    const viewport = viewportRef.current
    const flow = flowRef.current

    if (!viewport || !flow) {
      return
    }

    const measure = (): void => {
      const [width = 0, height = 0] = (
        flow.querySelector("article")?.style.aspectRatio ?? ""
      )
        .split("/")
        .map((part: string) => Number.parseFloat(part))

      if (width > 0 && height > 0) {
        onPageRatio(height / width)
      }

      setPageCount(
        Math.max(1, Math.ceil(viewport.scrollHeight / viewport.clientHeight - 0.05))
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(flow)

    return () => observer.disconnect()
  }, [onPageRatio, pageHeight, preview])

  function turn(step: number): void {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const next = Math.min(pageCount - 1, Math.max(0, pageIndex + step))
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    viewport.scrollTo({
      behavior: reduced ? "auto" : "smooth",
      top: next * viewport.clientHeight,
    })
    setPageIndex(next)
  }

  function followScroll(event: UIEvent<HTMLDivElement>): void {
    const viewport = event.currentTarget
    const atEnd =
      viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1

    setPageIndex(
      atEnd ? pageCount - 1 : Math.round(viewport.scrollTop / viewport.clientHeight)
    )
  }

  return (
    <>
      <div className="relative" data-document-surface="paper">
        {/* The notch sits behind the page, pointing back at the row. */}
        <span
          aria-hidden="true"
          className="absolute -left-[5px] size-3 -translate-y-1/2 rotate-45 rounded-[2px] bg-card"
          data-slot="submission-preview-caret"
          style={{ top: caretTop }}
        />
        <div
          className="relative overflow-y-auto rounded-[4px] bg-card shadow-[0_18px_40px_rgba(37,35,41,0.2),0_2px_6px_rgba(37,35,41,0.12)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={followScroll}
          ref={viewportRef}
          style={{ height: pageHeight, width: PAGE_WIDTH }}
        >
          {preview ? (
            <div
              ref={flowRef}
              style={{ width: DOCUMENT_WIDTH, zoom: PAGE_WIDTH / DOCUMENT_WIDTH }}
            >
              <GeneratedDocumentContent
                answers={preview.answers}
                content={preview.content}
                editable={false}
                title={preview.title}
              />
            </div>
          ) : failed ? null : (
            <div className="size-full bg-muted/60 motion-safe:animate-pulse" />
          )}
        </div>
      </div>
      <div
        className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums [text-shadow:0_0_6px_var(--background)]"
        style={{ height: NAV_HEIGHT }}
      >
        {failed ? (
          <span>Preview unavailable</span>
        ) : (
          <>
            <PageArrow
              disabled={pageIndex === 0}
              label="Previous page"
              onClick={() => turn(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </PageArrow>
            <span className="min-w-[3.4em] text-center">
              {pageIndex + 1} / {pageCount}
            </span>
            <PageArrow
              disabled={pageIndex >= pageCount - 1}
              label="Next page"
              onClick={() => turn(1)}
            >
              <ChevronRight aria-hidden="true" />
            </PageArrow>
          </>
        )}
      </div>
    </>
  )
}

function PageArrow({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      aria-label={label}
      className="grid size-7 place-items-center rounded-[8px] text-foreground transition-colors outline-none hover:text-primary disabled:text-muted-foreground/45 [filter:drop-shadow(0_0_3px_var(--background))] [&_svg]:size-4"
      disabled={disabled}
      onClick={onClick}
      tabIndex={-1}
      type="button"
    >
      {children}
    </button>
  )
}

/**
 * Pins the pages just past the title and level with its row. They may cover
 * the columns beside the title while they are open.
 */
function anchorPreview(link: HTMLElement): PreviewAnchor {
  const row = link.closest<HTMLElement>('[data-slot="submission-row"]') ?? link
  const rowBox = row.getBoundingClientRect()
  const left = Math.min(
    link.getBoundingClientRect().right + TITLE_GAP,
    window.innerWidth - PAGE_WIDTH - EDGE
  )

  return {
    left: Math.max(EDGE, left),
    rowMiddle: rowBox.top + rowBox.height / 2,
    rowTop: rowBox.top,
  }
}

async function requestSubmissionPreview(
  organizationId: string,
  submissionId: string
): Promise<SubmissionPreview> {
  const response = await fetch(
    `/api/submissions/${encodeURIComponent(submissionId)}/preview`,
    {
      body: JSON.stringify({ organizationId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  )

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Preview unavailable."))
  }

  return (await response.json()) as SubmissionPreview
}
