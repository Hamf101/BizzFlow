"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import {
  CornerDownLeft,
  FileText,
  Folder,
  Inbox,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  Search,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { fileListState, getDocumentHref, getFolderHref } from "@/components/files/file-list-view"
import { getVisibleNavigationItems } from "@/components/navigation/navigation-items"
import { useNavigationPreferences } from "@/components/navigation/navigation-preferences-provider"
import { getMemberDisplayName, getMemberRoleName } from "@/components/people/member-name"
import {
  getSubmissionStatusLabel,
  SubmissionStatusBadge,
} from "@/components/submissions/submission-status-badge"
import { TaskStatusBadge } from "@/components/tasks/task-presentation"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { formatMediumDate } from "@/lib/date-format"
import type { OrganizationPermissionSubject } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type {
  WorkspaceSearchHit,
  WorkspaceSearchKind,
  WorkspaceSearchResult,
} from "@/services/workspace-search-service"

// One search, opened from the sidebar, the phone's top bar, or the keyboard.
const searchHandle = DialogPrimitive.createHandle()

// A tab's own address, and the section of the search it stands for.
const KINDS: Readonly<Record<string, WorkspaceSearchKind>> = {
  "/documents": "files",
  "/people": "people",
  "/submissions": "submissions",
  "/tasks": "tasks",
  "/templates": "templates",
}
const ICONS: Readonly<Record<WorkspaceSearchKind, LucideIcon>> = {
  files: FileText,
  people: UserRound,
  submissions: Inbox,
  tasks: ListChecks,
  templates: LayoutTemplate,
}
const TEMPLATE_STATUSES = { archived: "Archived", draft: "Draft", published: "Published" } as const
// What a section shows once chosen, before a word is typed (the service's
// finders say how each list is made).
const OPENING: Readonly<Record<WorkspaceSearchKind, string>> = {
  files: "Recent",
  people: "Everyone",
  submissions: "Recent",
  tasks: "Due soon",
  templates: "Recent",
}
const WAIT_MS = 150
// Where the bar was left, in this browser.
const PLACE_KEY = "bizflow.search.place"
// Wide enough to carry the bar about; on a phone it keeps to the top.
const WIDE = "(min-width: 48rem)"
// A press that travels this far carries the bar rather than clicking.
const DRAG_THRESHOLD = 4
// The bar keeps this far inside the screen, and room for its results.
const EDGE = 16
const RESULTS_ROOM = 417

type Point = Readonly<{ x: number; y: number }>

/**
 * Where the bar sits on a wide screen. It opens away from the nearer edge of
 * the screen: in the top half, results open underneath and the bar is held by
 * its top edge; in the bottom half, they open above and it is held by its
 * bottom edge. Either way the box stays put as results come and go.
 */
type Place = Readonly<{
  /** How far the held edge sits from that edge of the screen; none, 13% down. */
  edge: number | null
  up: boolean
  /** How far the bar's middle sits right of the screen's middle. */
  x: number
}>

const HOME: Place = { edge: null, up: false, x: 0 }

type Section = Readonly<{ href: string; kind: WorkspaceSearchKind; label: string }>

// What one hit's row and preview show.
type Shown = Readonly<{
  copy: Readonly<{ label: "Copy email" | "Copy link"; text: string }>
  description: string | null
  facts: ReadonlyArray<readonly [label: string, value: string]>
  href: string
  icon: LucideIcon
  meta: string
  status: ReactNode
  title: string
}>

// A way to go: a hit, or a section's whole list with the same words.
type Option = Readonly<{ hit?: WorkspaceSearchHit; href: string; key: string }>

/**
 * The key that opens search, as this keyboard spells it: ⌘K on a Mac, iPhone
 * or iPad, where ⌘Space belongs to Spotlight, and Ctrl K everywhere else.
 * Drawn once the page knows which, so the server and browser agree.
 *
 * @param props - Classes for the key.
 * @returns The shortcut, or nothing yet.
 */
export function SearchShortcut({ className }: { className?: string }): ReactElement | null {
  const shortcut = useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K"),
    () => null
  )

  return shortcut ? <Key className={className}>{shortcut}</Key> : null
}

function subscribeToNothing(): () => void {
  return () => undefined
}

/**
 * Opens search from anywhere on the page it is drawn.
 *
 * @param props - Base UI trigger properties.
 * @returns The trigger.
 */
export function WorkspaceSearchTrigger(props: DialogPrimitive.Trigger.Props): ReactElement {
  return <DialogPrimitive.Trigger handle={searchHandle} {...props} />
}

/**
 * Searches everything the member may open, like Spotlight: ⌘K or Ctrl K from
 * any page, or a search button. Filters at the top narrow it to one section,
 * each hit is previewed beside the list, and a section's whole list opens
 * with the same words.
 *
 * @param props - The member's role, which decides the sections.
 * @returns The search, closed until opened.
 */
export function WorkspaceSearch({ role }: { role: OrganizationPermissionSubject | null }): ReactElement {
  const [place, setPlace] = useState<Place>(readPlace)
  // How far the bar has been carried and not yet let go.
  const [carried, setCarried] = useState<Point>({ x: 0, y: 0 })
  const bar = useRef<HTMLDivElement>(null)

  // Any part of the bar but its controls carries it, as the editor's tools
  // carry: the box keeps its typing and selecting, the list its scrolling.
  function carry(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target as Element

    if (event.button !== 0 || !matchMedia(WIDE).matches || target.closest("input, button, a, [role='listbox']")) {
      return
    }

    event.preventDefault()
    const measured = measure(event.currentTarget, place)
    const press = { moved: false, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    const to = (at: globalThis.PointerEvent): Point => measured.carry({ x: at.clientX - press.x, y: at.clientY - press.y })

    function move(at: globalThis.PointerEvent): void {
      if (at.pointerId !== press.pointerId || (!press.moved && Math.hypot(at.clientX - press.x, at.clientY - press.y) < DRAG_THRESHOLD)) {
        return
      }

      press.moved = true
      setCarried(to(at))
    }

    function end(at: globalThis.PointerEvent): void {
      if (at.pointerId !== press.pointerId) {
        return
      }

      removeEventListener("pointermove", move)
      removeEventListener("pointerup", end)
      removeEventListener("pointercancel", end)

      if (press.moved) {
        const left = measured.rest(to(at))
        setCarried({ x: 0, y: 0 })
        setPlace(left)

        try {
          localStorage.setItem(PLACE_KEY, JSON.stringify(left))
        } catch {
          // Without storage, the bar stays put until the page reloads.
        }
      }
    }

    addEventListener("pointermove", move)
    addEventListener("pointerup", end)
    addEventListener("pointercancel", end)
  }

  useEffect(() => {
    function toggle(event: globalThis.KeyboardEvent): void {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()

        if (searchHandle.isOpen) {
          searchHandle.close()
        } else {
          searchHandle.open(null)
        }
      }
    }

    addEventListener("keydown", toggle)
    return () => removeEventListener("keydown", toggle)
  }, [])

  return (
    <DialogPrimitive.Root
      handle={searchHandle}
      // No backdrop, and no hold on the page: like Spotlight, the page stays
      // in view and scrolls beneath, and a click on it puts search away.
      modal="trap-focus"
      // A screen grown smaller since the bar was left brings it back in view.
      onOpenChangeComplete={(open) => {
        if (open && bar.current && matchMedia(WIDE).matches) {
          const settled = measure(bar.current, place).rest({ x: 0, y: 0 })

          if (settled.up !== place.up || settled.x !== place.x || settled.edge !== (place.edge ?? settled.edge)) {
            setPlace(settled)
          }
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className={cn(
            // On a phone, across the top where the keyboard never covers it;
            // wider, wherever it was left (see Place).
            "fixed top-[max(env(safe-area-inset-top),0.75rem)] left-1/2 z-50 flex w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[22px] outline-none md:top-[var(--search-top)] md:bottom-[var(--search-bottom)] md:left-[calc(50%_+_var(--search-x))] md:w-[min(46rem,calc(100vw-4rem))] md:[transform:translate(var(--carried-x),var(--carried-y))]",
            // Glass: the page shows through, blurred, as Spotlight's does.
            "border border-foreground/10 bg-popover/60 text-popover-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_30px_90px_-24px_rgb(0_0_0/0.38)] backdrop-blur-[30px] backdrop-saturate-[1.7]",
            "origin-top transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none",
            place.up && "md:origin-bottom"
          )}
          data-opens={place.up ? "up" : "down"}
          data-slot="workspace-search"
          onPointerDown={carry}
          ref={bar}
          style={
            {
              "--carried-x": `${carried.x}px`,
              "--carried-y": `${carried.y}px`,
              "--search-bottom": place.up ? `${place.edge ?? EDGE}px` : "auto",
              "--search-top": place.up ? "auto" : place.edge === null ? "13vh" : `${place.edge}px`,
              "--search-x": `${place.x}px`,
            } as CSSProperties
          }
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <SearchPanel role={role} up={place.up} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SearchPanel({ role, up }: { role: OrganizationPermissionSubject | null; up: boolean }): ReactElement {
  const customization = useNavigationPreferences()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const listId = useId()
  const [text, setText] = useState("")
  const [kind, setKind] = useState<WorkspaceSearchKind | null>(null)
  const [found, setFound] = useState<Readonly<{ kind: WorkspaceSearchKind | null; result: WorkspaceSearchResult; words: string }> | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const words = text.trim()
  // In the order, and under the names, of the member's own tabs.
  const sections: Section[] = getVisibleNavigationItems(role, customization?.preferences).flatMap((item) => {
    const itemKind = KINDS[item.href]
    return itemKind ? [{ href: item.href, kind: itemKind, label: item.label }] : []
  })
  const section = sections.find((each) => each.kind === kind)
  // Two letters make a search; before that, a chosen section opens its own
  // list, as a Spotlight category does.
  const asked = words.length >= 2 ? words : ""
  const opening = !asked && section !== undefined
  const current =
    found && (asked ? found.words !== "" : opening && found.words === "" && found.kind === kind) ? found : null
  // Narrowing shows at once what is already here, while the rest arrives.
  const hits = current
    ? current.result.hits.filter((hit) => !section || hit.kind === section.kind).sort(
        (one, other) =>
          sections.findIndex((each) => each.kind === one.kind) - sections.findIndex((each) => each.kind === other.kind)
      )
    : []
  const total = section ? current?.result.totals[section.kind] : undefined
  const options: Option[] = [
    ...hits.map((hit) => ({ hit, href: present(hit).href, key: `${hit.kind}:${hit.item.id}` })),
    // The whole list, searched as its own box used to: from that list, its
    // view carries over and paging starts again.
    ...(section && current && current.kind === section.kind && (opening || total)
      ? [{ href: listHref(section.href, asked, pathname === section.href ? searchParams.toString() : ""), key: "all" }]
      : []),
  ]
  const chosen = options[Math.min(active, options.length - 1)]

  useEffect(() => {
    if (!asked && !kind) {
      return undefined
    }

    const params = new URLSearchParams()

    if (kind) {
      params.set("kind", kind)
    }

    if (asked) {
      params.set("q", asked)
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal })
        const payload = (await response.json().catch(() => ({}))) as Partial<WorkspaceSearchResult> & { error?: string }

        if (!response.ok || !payload.hits || !payload.totals) {
          throw new Error(payload.error ?? "Search failed. Try again.")
        }

        if (controller.signal.aborted) {
          return
        }

        setFound({ kind, result: { hits: payload.hits, totals: payload.totals }, words: asked })
        setFailure(null)
        setActive(0)
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setFailure(error instanceof Error ? error.message : "Search failed. Try again.")
        }
      }
    }, WAIT_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [asked, kind])

  // Keeps the chosen row in sight as the arrow keys move it.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active, listId])

  function go(href: string): void {
    searchHandle.close()
    router.push(href)
  }

  function move(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))))
    } else if (event.key === "Enter" && chosen && !event.nativeEvent.isComposing) {
      event.preventDefault()
      go(chosen.href)
    }
  }

  // Counts are of what the words found.
  const counted = asked ? current : null
  const every = counted ? Object.values(counted.result.totals).reduce((sum, count) => sum + (count ?? 0), 0) : undefined
  const filters = [{ count: every, kind: null, label: "All" }, ...sections.map((each) => ({ count: counted?.result.totals[each.kind], kind: each.kind, label: each.label }))]

  // Read box first. Drawn with the filters above the box, results on the side
  // the bar opens to, and the hints beyond them.
  return (
    <div className={cn("flex flex-col divide-y divide-foreground/[0.08]", up && "md:flex-col-reverse md:divide-y-reverse")}>
      <div className="flex flex-col-reverse gap-3 px-4 py-3.5 md:px-5" data-slot="workspace-search-head">
        <div className="flex items-center gap-3">
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <input
            aria-activedescendant={chosen ? `${listId}-${options.indexOf(chosen)}` : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={options.length > 0}
            aria-label="Search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-lg tracking-[-0.01em] outline-none placeholder:text-muted-foreground md:text-xl"
            enterKeyHint="go"
            maxLength={100}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={move}
            placeholder={section ? `Search ${section.label.toLowerCase()}…` : "Search everything…"}
            role="combobox"
            spellCheck={false}
            value={text}
          />
          <DialogPrimitive.Close
            aria-label="Close search"
            className="rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Key>esc</Key>
          </DialogPrimitive.Close>
        </div>
        <div aria-label="Search in" className="-m-0.5 flex gap-1.5 overflow-x-auto p-0.5" role="group">
          {filters.map((filter) => (
            <button
              aria-pressed={kind === filter.kind}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                kind === filter.kind
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/[0.06] text-foreground hover:bg-foreground/10"
              )}
              key={filter.label}
              onClick={() => setKind(filter.kind)}
              type="button"
            >
              {filter.label}
              {filter.count !== undefined ? (
                <span className="ml-1.5 text-current/65 tabular-nums">{filter.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {asked || opening ? (
        <div className="grid md:h-[26rem] md:grid-cols-2">
          <div
            aria-label="Results"
            className="max-h-[min(26rem,55dvh)] overflow-y-auto p-2 md:max-h-none md:border-r md:border-foreground/[0.08]"
            id={listId}
            role="listbox"
          >
            {options.length > 0 ? (
              options.map((option, index) => (
                <Fragment key={option.key}>
                  {option.hit && (opening ? index === 0 : !section && option.hit.kind !== options[index - 1]?.hit?.kind) ? (
                    <div
                      aria-hidden="true"
                      className="px-2.5 pt-3 pb-1 text-[10px] font-semibold tracking-[0.16em] text-primary uppercase first:pt-1.5"
                    >
                      {opening && section ? OPENING[section.kind] : sections.find((each) => each.kind === option.hit?.kind)?.label}
                    </div>
                  ) : null}
                  <Link
                    aria-selected={option === chosen}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-[12px] px-2.5 py-2 outline-none",
                      option === chosen && "bg-primary/15"
                    )}
                    href={option.href}
                    id={`${listId}-${index}`}
                    onClick={() => searchHandle.close()}
                    onMouseMove={() => setActive(index)}
                    role="option"
                    tabIndex={-1}
                  >
                    {option.hit ? (
                      <HitRow hit={option.hit} />
                    ) : (
                      <span className="flex-1 px-0.5 text-[13px] text-primary">
                        {opening ? `Go to ${section?.label} →` : `Show all ${total} in ${section?.label} →`}
                      </span>
                    )}
                    {option === chosen ? (
                      <CornerDownLeft aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    ) : null}
                  </Link>
                </Fragment>
              ))
            ) : (
              <p className="px-3 py-6 text-sm text-muted-foreground" role="status">
                {failure ?? (current ? `Nothing${section ? ` in ${section.label}` : ""} matches “${current.words}”.` : "Searching…")}
              </p>
            )}
          </div>
          <div className="hidden overflow-y-auto md:block">
            {chosen?.hit ? <Preview hit={chosen.hit} key={chosen.key} onOpen={go} /> : null}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground md:px-5">
        <span>Only what you can open</span>
        <span className="hidden items-center gap-1.5 md:flex">
          <Key>↑</Key>
          <Key>↓</Key>
          <span className="mr-2">move</span>
          <Key>↵</Key>
          <span>open</span>
        </span>
      </div>
    </div>
  )
}

function HitRow({ hit }: { hit: WorkspaceSearchHit }): ReactElement {
  const shown = present(hit)

  return (
    <>
      <Tile icon={shown.icon} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm font-medium">{shown.title}</span>
        <span className="truncate text-xs text-muted-foreground">{shown.meta}</span>
      </span>
    </>
  )
}

function Preview({ hit, onOpen }: { hit: WorkspaceSearchHit; onOpen: (href: string) => void }): ReactElement {
  const shown = present(hit)
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        shown.copy.label === "Copy link" ? new URL(shown.copy.text, location.href).href : shown.copy.text
      )
      setCopied(true)
    } catch {
      // A browser that won't allow it leaves the button as it was.
    }
  }

  return (
    <div className="grid content-start gap-5 p-6" data-slot="workspace-search-preview">
      <Tile icon={shown.icon} large />
      <div className="grid justify-items-start gap-2">
        <p className="font-editorial text-xl leading-tight tracking-[-0.01em] break-words">{shown.title}</p>
        {shown.status}
        {shown.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{shown.description}</p>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
        {shown.facts.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="flex gap-2">
        <button className={cn(buttonVariants({ size: "sm" }))} onClick={() => onOpen(shown.href)} type="button">
          Open
        </button>
        <button
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "bg-transparent")}
          onClick={() => void copy()}
          type="button"
        >
          {copied ? "Copied" : shown.copy.label}
        </button>
      </div>
    </div>
  )
}

function Tile({ icon: Icon, large = false }: { icon: LucideIcon; large?: boolean }): ReactElement {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-primary/12 text-primary",
        large ? "size-13 rounded-[14px]" : "size-8 rounded-[9px]"
      )}
    >
      <Icon aria-hidden="true" className={large ? "size-6" : "size-4"} />
    </span>
  )
}

function Key({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <kbd
      className={cn(
        "rounded-[6px] border border-foreground/15 bg-foreground/[0.04] px-1.5 py-1 font-sans text-[11px] leading-none font-medium whitespace-nowrap text-foreground/70",
        className
      )}
    >
      {children}
    </kbd>
  )
}

function readPlace(): Place {
  try {
    const kept = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as Partial<Place> | null

    if (typeof kept?.edge === "number" && typeof kept.up === "boolean" && typeof kept.x === "number") {
      return { edge: kept.edge, up: kept.up, x: kept.x }
    }
  } catch {
    // No storage, or nothing kept: the bar opens where it always has.
  }

  return HOME
}

/**
 * Measures the bar once, before it moves, for where it may be carried and
 * where it comes to rest.
 *
 * @param bar - The bar, where it stands now.
 * @param place - Where it was left.
 * @returns `carry`, which keeps its box and filters on screen while the rest
 *   may run off until it is let go; and `rest`, where it lands: opening away
 *   from the nearer edge of the screen, held by the edge its box is on, with
 *   room on the other side for the rest of it and its results.
 */
function measure(bar: HTMLElement, place: Place): { carry: (by: Point) => Point; rest: (by: Point) => Place } {
  const whole = bar.getBoundingClientRect()
  const head = bar.querySelector("[data-slot='workspace-search-head']")?.getBoundingClientRect() ?? whole
  const tall = whole.height + (bar.querySelector("[role='listbox']") ? 0 : RESULTS_ROOM)

  return {
    carry: (by) => ({
      x: Math.max(Math.min(by.x, innerWidth - EDGE - whole.right), EDGE - whole.left),
      y: Math.max(Math.min(by.y, innerHeight - EDGE - head.bottom), EDGE - head.top),
    }),
    rest: (by) => {
      const top = head.top + by.y
      const bottom = head.bottom + by.y
      const up = top + bottom > innerHeight

      return {
        edge: Math.min(Math.max(up ? innerHeight - bottom : top, EDGE), Math.max(EDGE, innerHeight - EDGE - tall)),
        up,
        x: place.x + by.x + Math.max(0, EDGE - (whole.left + by.x)) - Math.max(0, whole.right + by.x - (innerWidth - EDGE)),
      }
    },
  }
}

function listHref(path: string, words: string, view: string): string {
  const params = new URLSearchParams(view)
  params.delete("page")

  if (words) {
    params.set("q", words)
  } else {
    params.delete("q")
  }

  const query = params.toString()

  return query ? `${path}?${query}` : path
}

function present(hit: WorkspaceSearchHit): Shown {
  const link = (href: string) => ({ label: "Copy link" as const, text: href })

  switch (hit.kind) {
    case "files": {
      if (hit.folder) {
        const { item } = hit
        const href = getFolderHref(fileListState.parse({}), item.id)

        return {
          copy: link(href),
          description: null,
          facts: [
            ["Kind", "Folder"],
            ["Created", formatMediumDate(item.createdAt)],
            ["Edited", formatMediumDate(item.updatedAt)],
          ],
          href,
          icon: Folder,
          meta: `Folder · edited ${formatMediumDate(item.updatedAt)}`,
          status: null,
          title: item.name,
        }
      }

      const { item } = hit
      const href = getDocumentHref(item)

      return {
        copy: link(href),
        description: item.description,
        facts: [
          ["Kind", item.sourceKind === "generated" ? "Document" : "Uploaded file"],
          ["Created", formatMediumDate(item.createdAt)],
          ["Edited", formatMediumDate(item.updatedAt)],
        ],
        href,
        icon: ICONS.files,
        meta: `Edited ${formatMediumDate(item.updatedAt)}`,
        status: null,
        title: item.title,
      }
    }
    case "people": {
      const { item } = hit
      const roleName = getMemberRoleName(item)

      return {
        copy: { label: "Copy email", text: item.email },
        description: null,
        facts: [
          ["Email", item.email],
          ["Role", roleName],
          ["Joined", formatMediumDate(item.createdAt)],
        ],
        href: `/people?q=${encodeURIComponent(item.email)}`,
        icon: ICONS.people,
        meta: `${roleName} · ${item.email}`,
        status: null,
        title: getMemberDisplayName(item),
      }
    }
    case "submissions": {
      const { item } = hit
      const href = `/submissions/${encodeURIComponent(item.id)}`

      return {
        copy: link(href),
        description: null,
        facts: [
          ["Started", formatMediumDate(item.createdAt)],
          ["Submitted", item.submittedAt ? formatMediumDate(item.submittedAt) : "Not yet"],
          ["Updated", formatMediumDate(item.updatedAt)],
        ],
        href,
        icon: ICONS.submissions,
        meta: getSubmissionStatusLabel(item.status),
        status: <SubmissionStatusBadge status={item.status} />,
        title: item.title,
      }
    }
    case "tasks": {
      const { item } = hit
      const href = `/tasks/${encodeURIComponent(item.id)}`
      const due = item.dueAt ? formatMediumDate(item.dueAt) : null

      return {
        copy: link(href),
        description: item.description,
        facts: [
          ["Due", due ?? "No due date"],
          ["Updated", formatMediumDate(item.updatedAt)],
        ],
        href,
        icon: ICONS.tasks,
        meta: due ? `Due ${due}` : "No due date",
        status: <TaskStatusBadge status={item.status} />,
        title: item.title,
      }
    }
    case "templates": {
      const { item } = hit
      const href = `/templates/${encodeURIComponent(item.id)}/edit`

      return {
        copy: link(href),
        description: null,
        facts: [
          ["Category", item.category ?? "None"],
          ["Created", formatMediumDate(item.createdAt)],
          ["Updated", formatMediumDate(item.updatedAt)],
        ],
        href,
        icon: ICONS.templates,
        meta: [TEMPLATE_STATUSES[item.status], item.category].filter(Boolean).join(" · "),
        status: <Badge variant="outline">{TEMPLATE_STATUSES[item.status]}</Badge>,
        title: item.title,
      }
    }
  }
}
