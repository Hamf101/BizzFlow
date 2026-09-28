"use client"

import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown } from "lucide-react"
import { type ReactElement, useEffect, useMemo, useState } from "react"

import { DocumentFontStyles, documentFontFamily } from "@/components/templates/document-font-styles"
import { cn } from "@/lib/utils"

type Font = Readonly<{ category: string; family: string; id: string }>
type FontGroup = Readonly<{ items: readonly string[]; label: string }>

// Google Docs' own list, with Google Fonts' stand-ins for the Microsoft fonts
// in it: each takes the same room on the page as the font it stands in for.
const POPULAR = [
  "arimo", "caladea", "carlito", "caveat", "comic-neue", "cousine", "eb-garamond", "gelasio", "inter", "lato", "lora",
  "merriweather", "montserrat", "nunito", "open-sans", "oswald", "pacifico", "playfair-display", "poppins", "roboto",
  "roboto-mono", "spectral", "tinos",
]
const STANDS_IN_FOR: Readonly<Record<string, string>> = {
  arimo: "Arial",
  caladea: "Cambria",
  carlito: "Calibri",
  cousine: "Courier New",
  gelasio: "Georgia",
  tinos: "Times New Roman",
}
const RESULTS = 50

let catalog: Promise<readonly Font[]> | undefined

/**
 * The font menu: the page's default, the families the document already uses
 * and a popular few, each shown in its own face, and a search across every
 * family Google Fonts has.
 *
 * @param props - The chosen family, the document's families, and what to do on a choice.
 * @returns The menu's button and popup.
 */
export function FontPicker({
  disabled,
  documentFonts,
  narrow,
  onChange,
  value,
}: {
  disabled: boolean
  documentFonts: readonly string[]
  narrow: boolean
  onChange: (font: string | null) => void
  value?: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [fonts, setFonts] = useState<readonly Font[] | null>(null)
  const [failed, setFailed] = useState(false)
  const families = useMemo(() => new Map(fonts?.map((font) => [font.id, font.family])), [fonts])
  const needle = query.trim().toLowerCase()
  const groups = needle ? [{ items: search(fonts ?? [], needle), label: "" }] : browse(documentFonts)
  // The document's families and the popular few show in their own faces;
  // others do not, so a search does not fetch a face for every match.
  const previewed = new Set([...documentFonts, ...POPULAR])
  const name = (id: string): string => (id ? (families.get(id) ?? spell(id)) : "Default font")

  // The list loads the first time it opens, or as soon as a chosen family
  // needs its name spelled properly.
  useEffect(() => {
    if (fonts || !(open || value)) {
      return
    }

    let current = true

    loadCatalog().then(
      (list) => current && setFonts(list),
      () => current && setFailed(true)
    )

    return () => {
      current = false
    }
  }, [fonts, open, value])

  return (
    <Combobox.Root
      autoHighlight
      filteredItems={groups}
      inputValue={query}
      itemToStringLabel={name}
      items={groups}
      onInputValueChange={setQuery}
      onOpenChange={(next: boolean) => {
        setOpen(next)
        setQuery("")
        setFailed(false)
      }}
      onValueChange={(next: string | null) => onChange(next || null)}
      open={open}
      value={value ?? ""}
    >
      <Combobox.Trigger
        aria-label={`Font: ${name(value ?? "")}`}
        className={cn(
          "inline-flex w-32 shrink-0 items-center justify-between gap-1 rounded-[8px] px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 data-popup-open:bg-muted",
          narrow ? "h-11" : "h-8"
        )}
        disabled={disabled}
      >
        <span className="truncate">{name(value ?? "")}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" className="isolate z-50 outline-none" side={narrow ? "top" : "bottom"} sideOffset={4}>
          <Combobox.Popup
            aria-label="Fonts"
            className="flex max-h-[min(26rem,var(--available-height))] w-72 origin-(--transform-origin) flex-col rounded-[12px] border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
          >
            <DocumentFontStyles fonts={open ? [...previewed] : []} />
            <Combobox.Input
              className="m-1 h-9 shrink-0 rounded-[8px] border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              placeholder="Search fonts, like Arial or serif"
            />
            <Combobox.List className="min-h-0 overflow-y-auto">
              {(group: FontGroup) => (
                <Combobox.Group items={group.items} key={group.label}>
                  {group.label ? (
                    <Combobox.GroupLabel className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{group.label}</Combobox.GroupLabel>
                  ) : null}
                  <Combobox.Collection>
                    {(id: string) => (
                      <Combobox.Item
                        className="flex cursor-default items-center gap-2 rounded-[8px] px-2 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                        key={id}
                        value={id}
                      >
                        <span className="grid size-4 shrink-0 place-items-center">
                          <Combobox.ItemIndicator>
                            <Check aria-hidden="true" className="size-4" />
                          </Combobox.ItemIndicator>
                        </span>
                        <span className="truncate text-[15px]" style={previewed.has(id) ? { fontFamily: documentFontFamily(id) } : undefined}>
                          {name(id)}
                        </span>
                        {STANDS_IN_FOR[id] ? (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">like {STANDS_IN_FOR[id]}</span>
                        ) : null}
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
            <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground empty:hidden" role="status">
              {failed
                ? "The fonts could not load. Close this and try again."
                : needle && !fonts
                  ? "Loading fonts…"
                  : needle && groups[0]?.items.length === 0
                    ? "No fonts match."
                    : !needle
                      ? `Search to find any of ${fonts?.length.toLocaleString("en") ?? "about 2,000"} fonts.`
                      : ""}
            </p>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/**
 * Finds families by name, by the font one stands in for, or by kind, such as
 * serif or handwriting: names that start with the search first.
 *
 * @param fonts - Every family.
 * @param needle - The search, in lower case.
 * @returns The first matches' names.
 */
function search(fonts: readonly Font[], needle: string): string[] {
  const ids = (list: readonly Font[]): string[] => list.map((font) => font.id)
  const standIns = Object.keys(STANDS_IN_FOR).filter((id) => STANDS_IN_FOR[id]!.toLowerCase().includes(needle))
  const named = fonts.filter((font) => font.family.toLowerCase().includes(needle))
  const starting = named.filter((font) => font.family.toLowerCase().startsWith(needle))
  const kind = fonts.filter((font) => font.category.includes(needle))

  return [...new Set([...standIns, ...ids(starting), ...ids(named), ...ids(kind)])].slice(0, RESULTS)
}

function browse(documentFonts: readonly string[]): FontGroup[] {
  const used = [...new Set(documentFonts)]

  return [
    { items: [""], label: "" },
    { items: used, label: "In this document" },
    { items: POPULAR.filter((id) => !used.includes(id)), label: "Popular" },
  ].filter((group) => group.items.length > 0)
}

function loadCatalog(): Promise<readonly Font[]> {
  catalog ??= fetch("/fonts/catalog.json")
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`The font list answered ${response.status}`)
      }

      return (await response.json()) as readonly Font[]
    })
    .catch((error: unknown) => {
      catalog = undefined
      throw error
    })

  return catalog
}

// A family's name from its id, until the list has loaded: "open-sans" is "Open Sans".
function spell(id: string): string {
  return id.replace(/(^|-)([a-z0-9])/g, (_, gap: string, letter: string) => `${gap ? " " : ""}${letter.toUpperCase()}`)
}
