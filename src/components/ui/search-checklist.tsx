"use client"

import { type ReactElement, useState } from "react"

import { Input } from "@/components/ui/input"
import type { SearchOption } from "@/components/ui/search-select"

// Fewer than this and the whole list is read at a glance.
const SEARCH_FROM = 7

/**
 * Checkboxes for a list of choices, with a box to narrow a long list as you
 * type. A choice the filter hides keeps its tick and is still sent with the
 * form, so narrowing never unpicks anyone.
 *
 * @param props - The choices, which start ticked, the field name, and the list's name.
 * @returns The checklist.
 */
export function SearchChecklist({
  defaultChecked = [],
  label,
  name,
  options,
}: {
  defaultChecked?: readonly string[]
  label: string
  name: string
  options: readonly SearchOption[]
}): ReactElement {
  const [query, setQuery] = useState("")
  const words = query.trim().toLowerCase()

  return (
    <div className="flex flex-col gap-1.5">
      {options.length >= SEARCH_FROM ? (
        <Input
          aria-label={`Search ${label.toLowerCase()}`}
          className="mb-1"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people"
          type="search"
          value={query}
        />
      ) : null}
      {options.map((option) => (
        <label
          className="flex items-center gap-2.5 text-sm"
          hidden={Boolean(words) && !`${option.label} ${option.hint ?? ""}`.toLowerCase().includes(words)}
          key={option.value}
        >
          <input className="size-4 accent-primary" defaultChecked={defaultChecked.includes(option.value)} name={name} type="checkbox" value={option.value} />
          <span className="min-w-0 truncate">{option.label}</span>
          {option.hint ? <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
        </label>
      ))}
    </div>
  )
}
