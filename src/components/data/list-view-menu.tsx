"use client"

import { Check, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { Fragment, type ReactElement } from "react"

import type {
  ListOption,
  ListOptionSection,
} from "@/components/data/list-option"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * Keeps a list's secondary view settings behind one quiet button.
 *
 * A dot on the button shows that a hidden setting differs from the default,
 * so a changed view is never invisible. Every choice is a link to the view it
 * describes.
 *
 * @param props - Button label, whether a hidden setting changed, and the choices.
 * @returns The view-options button and its menu.
 */
export function ListViewMenu({
  adjusted,
  label,
  sections,
}: {
  adjusted: boolean
  label: string
  sections: readonly ListOptionSection[]
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={adjusted ? `${label} (changed)` : label}
            className="relative size-11 rounded-[12px] bg-card"
            size="icon"
            type="button"
            variant="outline"
          >
            <SlidersHorizontal aria-hidden="true" />
            {adjusted ? (
              <span
                aria-hidden="true"
                className="absolute top-2 right-2 size-1.5 rounded-full bg-primary"
              />
            ) : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        {sections.map((section: ListOptionSection, index: number) => (
          <Fragment key={section.label}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
              {section.options.map((option: ListOption) => (
                <DropdownMenuItem
                  aria-current={option.selected ? "true" : undefined}
                  key={option.href}
                  render={<Link href={option.href} />}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(!option.selected && "invisible")}
                  />
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
