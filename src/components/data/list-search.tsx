"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import type { FormEvent, ReactElement } from "react"

import { Input } from "@/components/ui/input"

/**
 * One list's search box.
 *
 * Submitting moves to the searched list without reloading the document, so the
 * shell, its navigation, and every script stay as they are. The form keeps its
 * `action`, so a browser without scripting still searches by sending the same
 * address.
 *
 * @param props - The list's address, the settings a search carries over, and
 *   how the box reads.
 * @returns The list's search form.
 */
export function ListSearch({
  fields,
  label,
  maxLength,
  path,
  placeholder,
  query,
}: {
  fields: ReadonlyArray<readonly [name: string, value: string]>
  label: string
  maxLength: number
  path: string
  placeholder: string
  query: string
}): ReactElement {
  const router = useRouter()

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    // The form's own fields, in the order a plain submission would send them,
    // so the address is the one this list has always answered.
    const submitted = new URLSearchParams(
      Array.from(new FormData(event.currentTarget), ([name, value]) => [
        name,
        String(value),
      ])
    ).toString()

    router.push(submitted ? `${path}?${submitted}` : path)
  }

  return (
    <form action={path} className="min-w-0" onSubmit={search} role="search">
      {fields.map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <label className="relative block min-w-0">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label={label}
          className="h-11 rounded-[12px] bg-card pl-10 md:h-11"
          defaultValue={query}
          maxLength={maxLength}
          name="q"
          placeholder={placeholder}
          type="search"
        />
      </label>
    </form>
  )
}
