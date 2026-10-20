"use client"

import { FileText, Inbox, LayoutTemplate, ListChecks, LoaderCircle, type LucideIcon, User, X } from "lucide-react"
import { type ClipboardEvent, type ReactElement, useEffect, useMemo, useState } from "react"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export type FlowMentionKind = "templates" | "submissions" | "tasks" | "files" | "people"

/** Something a member pointed Flow at, with the name its chip shows. */
export type FlowMentionItem = Readonly<{ id: string; kind: FlowMentionKind; name: string }>

const KINDS: Readonly<Record<FlowMentionKind, { icon: LucideIcon; label: string }>> = {
  files: { icon: FileText, label: "File" },
  people: { icon: User, label: "Person" },
  submissions: { icon: Inbox, label: "Submission" },
  tasks: { icon: ListChecks, label: "Task" },
  templates: { icon: LayoutTemplate, label: "Template" },
}
// Pages that are one item, by the first part of their path. People have no page of their own.
const LINKED: Readonly<Record<string, FlowMentionKind>> = { documents: "files", submissions: "submissions", tasks: "tasks", templates: "templates" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The server reads five at most (flowMentionsSchema).
const MAX_MENTIONS = 5

/**
 * Reads a link to one item in this BizFlow as a mention. Only this site's own
 * pages count: Flow never opens a link anywhere else.
 *
 * @param text - What was pasted or typed.
 * @param origin - This site's origin.
 * @returns The item, or null for anything else.
 */
export function parseFlowLink(text: string, origin: string): Readonly<{ id: string; kind: FlowMentionKind }> | null {
  let url: URL

  try {
    url = new URL(text.trim(), origin)
  } catch {
    return null
  }

  const [section, id] = url.pathname.split("/").filter(Boolean)
  const kind = url.origin === origin && section ? LINKED[section] : undefined

  return kind && id && UUID.test(id) ? { id, kind } : null
}

/**
 * A mention made from a link, named by its kind until Flow reads its real name.
 *
 * @param link - The item the link points at.
 * @returns The mention.
 */
export function linkedMention(link: Readonly<{ id: string; kind: FlowMentionKind }>): FlowMentionItem {
  return { ...link, name: `${KINDS[link.kind].label} from link` }
}

export type FlowMentions = Readonly<{
  add: (item: FlowMentionItem) => void
  clear: () => void
  items: readonly FlowMentionItem[]
  /** A pasted link to one of this site's items becomes a mention instead of text. */
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  /** What goes with the message; nothing when nothing is mentioned. */
  payload: ReadonlyArray<{ id: string; kind: FlowMentionKind }> | undefined
  remove: (item: FlowMentionItem) => void
  /** Puts back what a failed send took, to send again. */
  restore: (items: readonly FlowMentionItem[]) => void
}>

/**
 * The things a member has mentioned for their next message to Flow.
 *
 * @returns The mentions and what changes them.
 */
export function useFlowMentions(): FlowMentions {
  const [items, setItems] = useState<readonly FlowMentionItem[]>([])

  return useMemo((): FlowMentions => {
    const add = (item: FlowMentionItem): void =>
      setItems((current) =>
        current.length >= MAX_MENTIONS || current.some((other) => other.id === item.id && other.kind === item.kind) ? current : [...current, item]
      )

    return {
      add,
      clear: () => setItems([]),
      items,
      onPaste(event) {
        const link = parseFlowLink(event.clipboardData.getData("text"), location.origin)

        if (!link) return

        event.preventDefault()
        add(linkedMention(link))
      },
      payload: items.length > 0 ? items.map(({ id, kind }) => ({ id, kind })) : undefined,
      remove: (item) => setItems((current) => current.filter((other) => other !== item)),
      restore: setItems,
    }
  }, [items])
}

/**
 * The mentions waiting to go with the next message, each one removable.
 *
 * @param props - The mentions.
 * @returns The chips, or nothing.
 */
export function FlowMentionChips({ mentions }: { mentions: FlowMentions }): ReactElement | null {
  if (mentions.items.length === 0) return null

  return (
    <ul aria-label="Mentioned" className="mb-1.5 flex flex-wrap gap-1.5">
      {mentions.items.map((item) => {
        const { icon: Icon, label } = KINDS[item.kind]

        return (
          <li
            className="flex max-w-full items-center gap-1.5 rounded-full bg-accent py-0.5 pr-0.5 pl-2 text-xs text-accent-foreground"
            data-slot="flow-mention"
            key={`${item.kind}:${item.id}`}
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">
              <span className="sr-only">{label}: </span>
              {item.name}
            </span>
            <button
              aria-label={`Remove ${item.name}`}
              className="grid size-5 shrink-0 place-items-center rounded-full outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring/40 max-md:size-7"
              onClick={() => mentions.remove(item)}
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

type Hit = Readonly<{ folder?: boolean; item: Record<string, unknown>; kind: FlowMentionKind }>

/**
 * Finds something in the workspace to hand Flow: a file to read, or anything to mention.
 *
 * @param props - Whether it is open, what it looks for, and what happens to the pick.
 * @returns The picker dialog.
 */
export function FlowPicker({
  onOpenChange,
  onPick,
  open,
  only,
}: {
  onOpenChange: (open: boolean) => void
  onPick: (item: FlowMentionItem) => void
  open: boolean
  /** One kind only, such as files to read; every kind otherwise. */
  only?: FlowMentionKind
}): ReactElement {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<readonly FlowMentionItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return undefined

    const controller = new AbortController()
    // Waits for a pause in typing, so each keystroke doesn't search.
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams()
      if (only) params.set("kind", only)
      if (query.trim()) params.set("q", query.trim())

      fetch(`/api/search?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed")
          const { hits: found } = (await response.json()) as { hits: readonly Hit[] }
          setFailed(false)
          // Flow reads uploaded files only; a document made here has no form to read.
          setHits(found.filter((hit) => !hit.folder && (only !== "files" || hit.item.sourceKind === "upload")).map(named).slice(0, 12))
        })
        .catch(() => {
          // A search the next keystroke replaced isn't a failure.
          if (!controller.signal.aborted) {
            setFailed(true)
            setHits([])
          }
        })
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [only, open, query])

  const close = (next: boolean): void => {
    if (!next) {
      setQuery("")
      setHits(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogTitle>{only === "files" ? "Add from Files" : "Mention"}</DialogTitle>
        <Input
          aria-label={only === "files" ? "Search your files" : "Search templates, files, submissions, tasks and people"}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder={only === "files" ? "Search your files" : "Search anything in your workspace"}
          value={query}
        />
        <div className="min-h-40" aria-live="polite">
          {hits === null ? (
            <LoaderCircle aria-label="Searching" className="mx-auto mt-6 size-4 animate-spin text-muted-foreground" />
          ) : hits.length === 0 ? (
            <p className="px-1 pt-4 text-sm text-muted-foreground">{failed ? "Search isn't available. Try again." : "Nothing matches that."}</p>
          ) : (
            <ul className="grid gap-0.5">
              {hits.map((hit) => {
                const { icon: Icon, label } = KINDS[hit.kind]

                return (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <button
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted max-md:py-3"
                      onClick={() => {
                        onPick(hit)
                        close(false)
                      }}
                      type="button"
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function named(hit: Hit): FlowMentionItem {
  const item = hit.item
  const name =
    hit.kind === "people"
      ? String(item.workspaceDisplayName || item.fullName || item.email || "Someone")
      : String(item.title || "Untitled")

  return { id: String(item.id), kind: hit.kind, name }
}
