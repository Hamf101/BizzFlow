"use client"

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { type KeyboardEvent, type ReactElement, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type { DatePickerProps } from "@/components/ui/date-picker"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { FIELD_BUTTON_CLASS_NAME, Select } from "@/components/ui/select"
import {
  type DateFormat,
  describeDateFormat,
  formatDateAnswer,
  MONTH_NAMES,
  toIsoDate,
} from "@/lib/date-format"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const
const SPOKEN_DATE: DateFormat = { month: "long", order: "dmy", separator: " " }

/**
 * The date field once someone reaches for it, with its calendar, which
 * `DatePicker` loads on demand. In the calendar the arrow keys move by day and
 * week, Page Up and Page Down by month (with Shift, by year), and Home and End
 * to the week's ends.
 *
 * @param props - The date picker's props, with a stored date or nothing, and
 *   whether the calendar opens as it mounts.
 * @returns The date field and its calendar.
 */
export default function DatePickerCalendar({
  "aria-describedby": describedBy,
  defaultOpen = false,
  format,
  id,
  name,
  onChange,
  required,
  value: chosen,
}: DatePickerProps & { defaultOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const [today] = useState<string>(() => toIsoDate(new Date()))
  // The day that holds the calendar's tab stop, and so which month shows.
  const [focused, setFocused] = useState<string>(chosen || today)
  const trigger = useRef<HTMLButtonElement>(null)
  const grid = useRef<HTMLTableElement>(null)
  // Weeks read from Sunday where dates are written month first, as in the US.
  const weekStart = format?.order === "mdy" ? 0 : 1
  const [year, month, day] = parts(focused)
  const firstOfMonth = isoOf(year, month, 1)
  const firstShown = addDays(firstOfMonth, -column(firstOfMonth, weekStart))
  const days = Array.from({ length: 42 }, (_, index: number): string => addDays(firstShown, index))
  const firstYear = Math.min(1900, year)
  const lastYear = Math.max(Number(today.slice(0, 4)) + 50, year)
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index: number): number => firstYear + index)

  function choose(next: string): void {
    onChange(next)
    setOpen(false)
  }

  function handleKey(event: KeyboardEvent<HTMLTableElement>): void {
    const moves: Record<string, (() => string) | undefined> = {
      ArrowDown: () => addDays(focused, 7),
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      End: () => addDays(focused, 6 - column(focused, weekStart)),
      Home: () => addDays(focused, -column(focused, weekStart)),
      PageDown: () => isoOf(year, month + (event.shiftKey ? 12 : 1), day),
      PageUp: () => isoOf(year, month - (event.shiftKey ? 12 : 1), day),
    }
    const move = moves[event.key]

    if (move) {
      const next = move()

      event.preventDefault()
      setFocused(next)
      requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus())
    }
  }

  return (
    <div className="relative">
      <Popover
        onOpenChange={(next: boolean): void => {
          if (next) {
            setFocused(chosen || today)
          }

          setOpen(next)
        }}
        open={open}
      >
        <PopoverTrigger
          aria-describedby={describedBy}
          aria-haspopup="dialog"
          className={FIELD_BUTTON_CLASS_NAME}
          id={id}
          ref={trigger}
          // Read as a field with a value, like the app's selects.
          role="combobox"
        >
          <span className={cn("min-w-0 truncate", !chosen && "text-muted-foreground")}>
            {chosen ? formatDateAnswer(chosen, format) : describeDateFormat(format)}
          </span>
          <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Choose a date"
          className="grid gap-2 p-2.5"
          initialFocus={() => grid.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? true}
        >
          <div className="flex items-center gap-1">
            <Button
              aria-label="Previous month"
              className="size-8"
              onClick={() => setFocused(isoOf(year, month - 1, day))}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ChevronLeft />
            </Button>
            <Select
              aria-label="Month"
              onChange={(event) => setFocused(isoOf(year, Number(event.target.value), day))}
              value={month}
            >
              {MONTH_NAMES.map((name: string, index: number) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Year"
              className="w-24 shrink-0"
              onChange={(event) => setFocused(isoOf(Number(event.target.value), month, day))}
              value={year}
            >
              {years.map((candidate: number) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </Select>
            <Button
              aria-label="Next month"
              className="size-8"
              onClick={() => setFocused(isoOf(year, month + 1, day))}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ChevronRight />
            </Button>
          </div>
          <table
            aria-label={`${MONTH_NAMES[month - 1]} ${year}`}
            className="border-separate border-spacing-0.5"
            onKeyDown={handleKey}
            ref={grid}
            role="grid"
          >
            <thead>
              <tr>
                {days.slice(0, 7).map((shown: string) => {
                  const weekday = WEEKDAYS[weekdayOf(shown)]

                  return (
                    <th abbr={weekday} className="h-8 text-xs font-normal text-muted-foreground" key={weekday} scope="col">
                      {weekday.slice(0, 2)}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((week: number) => (
                <tr key={week}>
                  {days.slice(week * 7, week * 7 + 7).map((shown: string) => {
                    const [, shownMonth, shownDay] = parts(shown)

                    return (
                      <td aria-selected={shown === chosen} key={shown} role="gridcell">
                        <button
                          aria-current={shown === today ? "date" : undefined}
                          aria-label={`${WEEKDAYS[weekdayOf(shown)]}, ${formatDateAnswer(shown, SPOKEN_DATE)}`}
                          className={cn(
                            "grid size-10 place-items-center rounded-[10px] text-sm tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                            shownMonth !== month && "text-muted-foreground/60",
                            shown === today && "font-semibold text-primary",
                            shown === chosen && "bg-primary text-primary-foreground hover:bg-primary"
                          )}
                          data-day={shown}
                          onClick={() => choose(shown)}
                          tabIndex={shown === focused ? 0 : -1}
                          type="button"
                        >
                          {shownDay}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between">
            <Button disabled={!chosen} onClick={() => choose("")} size="sm" type="button" variant="ghost">
              Clear
            </Button>
            <Button onClick={() => choose(today)} size="sm" type="button" variant="ghost">
              Today
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {/* Carries the date into the form, and lets `required` stop an empty one. */}
      <input
        aria-hidden="true"
        className="sr-only"
        name={name}
        onChange={() => undefined}
        onFocus={() => trigger.current?.focus()}
        required={required}
        tabIndex={-1}
        value={chosen}
      />
    </div>
  )
}

function parts(iso: string): [number, number, number] {
  const [year = 1970, month = 1, day = 1] = iso.split("-").map(Number)

  return [year, month, day]
}

// Months past either end roll into the next or last year, and a day past the
// month's end becomes its last, so 31 January plus a month is 28 February.
function isoOf(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()

  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = parts(iso)

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function weekdayOf(iso: string): number {
  const [year, month, day] = parts(iso)

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function column(iso: string, weekStart: number): number {
  return (weekdayOf(iso) - weekStart + 7) % 7
}
