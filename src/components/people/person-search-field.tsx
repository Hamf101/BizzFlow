"use client"

import { Autocomplete } from "@base-ui/react/autocomplete"
import { type ReactElement, useEffect, useState } from "react"

import { Input } from "@/components/ui/input"

/** Someone chosen to receive something: a name and the address it goes to. */
export type PersonChoice = Readonly<{ email: string; name: string }>

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/
const PICKED = /^(.+?)\s*<([^<>]+)>$/

/**
 * Reads a person field: someone picked from the workspace, shown as
 * "Name <email>", or anyone else by their email address alone.
 *
 * @param text - What the field holds.
 * @returns The person, or null when it is neither.
 */
export function readPersonChoice(text: string): PersonChoice | null {
  const value = text.trim()
  const picked = PICKED.exec(value)

  if (picked) {
    const email = picked[2]!.trim()
    return EMAIL.test(email) ? { email, name: picked[1]!.trim() } : null
  }

  return EMAIL.test(value) ? { email: value, name: value } : null
}

/**
 * One field to choose a person: typing shows matching people from the
 * workspace, the ones the sender may see, and an email address reaches
 * anyone else. "Name <email>" names someone from outside.
 *
 * @param props - Its accessible name or the id a label points at, the form field's name, and who hears each change.
 * @returns The field.
 */
export function PersonSearchField({
  id,
  label,
  name,
  onPersonChange,
}: {
  id?: string
  label?: string
  name?: string
  /** Hears the person the field now reads as, or null while it reads as nobody yet. */
  onPersonChange?: (person: PersonChoice | null) => void
}): ReactElement {
  const [text, setText] = useState("")
  const [people, setPeople] = useState<readonly PersonChoice[]>([])
  const [open, setOpen] = useState(false)
  const query = text.trim()
  // A person already picked, or an address typed in full, needs no search and no suggestions.
  const searching = query.length > 0 && !query.includes("<") && !EMAIL.test(query)

  useEffect(() => {
    if (!searching) return undefined

    const controller = new AbortController()
    // Waits for a pause in typing, so each key doesn't search.
    const timer = window.setTimeout(() => {
      fetch(`/api/search?kind=people&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => {
          // Someone who may not see people gets no suggestions and types an address instead.
          if (!response.ok) return setPeople([])
          const { hits } = (await response.json()) as { hits: ReadonlyArray<{ item: Record<string, unknown> }> }
          setPeople(
            hits
              .map(({ item }) => ({ email: String(item.email ?? ""), name: String(item.workspaceDisplayName || item.fullName || item.email || "") }))
              .filter((person) => person.email)
              .slice(0, 6)
          )
        })
        .catch(() => undefined)
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query, searching])

  return (
    <Autocomplete.Root
      filter={null}
      itemToStringValue={(person: PersonChoice) => `${person.name} <${person.email}>`}
      items={searching ? people : []}
      // Open only with someone to offer, and never hiding the rest of the form while it is.
      modal={false}
      name={name}
      onOpenChange={setOpen}
      onValueChange={(next: string) => {
        setText(next)
        onPersonChange?.(readPersonChoice(next))
      }}
      open={open && searching && people.length > 0}
      value={text}
    >
      <Autocomplete.Input render={<Input aria-label={label} autoComplete="off" id={id} maxLength={300} placeholder="Name or email" required />} />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="z-[60] outline-none" sideOffset={4}>
          <Autocomplete.Popup className="max-h-[min(16rem,var(--available-height))] w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 data-empty:hidden data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Autocomplete.List>
              {(person: PersonChoice) => (
                <Autocomplete.Item
                  className="flex cursor-default flex-col rounded-md px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-muted md:py-1.5"
                  key={person.email}
                  value={person}
                >
                  <span className="truncate">{person.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{person.email}</span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
