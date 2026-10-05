"use client"

import { CalendarDays } from "lucide-react"
import { lazy, type ReactElement, Suspense, useState } from "react"

import { Input } from "@/components/ui/input"
import { useTimeZone } from "@/components/ui/local-date"
import { FieldFace } from "@/components/ui/select"
import { type DateFormat, describeDateFormat, formatDateAnswer } from "@/lib/date-format"

const STORED_DATE = /^\d{4}-\d{2}-\d{2}$/
// The app's medium date, as lists show it: Sep 24, 2026.
const MEDIUM_DATE: DateFormat = { month: "short", order: "mdy", separator: " " }

/** What a date picker takes: its stored value, how it reads, and its form name. */
export type DatePickerProps = {
  "aria-describedby"?: string
  "aria-label"?: string
  className?: string
  format?: DateFormat
  id?: string
  name?: string
  onChange: (value: string) => void
  required?: boolean
  value: string
}

const loadCalendar = () => import("@/components/ui/date-picker-calendar")
const DatePickerCalendar = lazy(loadCalendar)

/**
 * A date field that opens the app's own calendar, in its light or dark
 * colours, instead of the platform's picker. The date reads the way its field
 * is formatted, and a form receives it as YYYY-MM-DD, as from a native date
 * input. The calendar's code loads when someone reaches for the field, or
 * sooner on hover or focus, so a page that only shows one stays light.
 *
 * @param props - The stored value, its change callback, the field's format,
 *   and the form name, id and requirement.
 * @returns The date field.
 */
export function DatePicker(props: DatePickerProps): ReactElement {
  const [reached, setReached] = useState(false)
  const chosen = STORED_DATE.test(props.value) ? props.value : ""
  const face = (
    <div className="relative">
      <FieldFace
        aria-describedby={props["aria-describedby"]}
        aria-label={props["aria-label"]}
        className={props.className}
        haspopup="dialog"
        icon={<CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        id={props.id}
        label={chosen ? formatDateAnswer(chosen, props.format) : describeDateFormat(props.format)}
        name={props.name}
        onReach={() => setReached(true)}
        onWarm={() => void loadCalendar()}
        placeholder={!chosen}
        required={props.required}
        value={chosen}
      />
    </div>
  )

  return reached ? (
    <Suspense fallback={face}>
      <DatePickerCalendar {...props} defaultOpen value={chosen} />
    </Suspense>
  ) : (
    face
  )
}

/**
 * A day and a time for a form, in the viewer's own time, posted as the moment
 * it is: an ISO string with its offset. The day comes from the app's
 * calendar, the time is typed, and a day chosen without a time starts at 09:00.
 *
 * @param props - The saved moment, as ISO, and the form name, id and requirement.
 * @returns The date and time fields.
 */
export function DateTimePicker({
  defaultValue = "",
  id,
  name,
  required,
}: {
  defaultValue?: string
  id?: string
  name?: string
  required?: boolean
}): ReactElement {
  // UTC while the server's page is taken over, then the viewer's own.
  const timeZone = useTimeZone()
  const [edited, setEdited] = useState<Readonly<{ date: string; time: string }> | null>(null)
  const { date, time } = edited ?? partsIn(defaultValue, timeZone)
  const setDate = (next: string): void => setEdited({ date: next, time: next && !time ? "09:00" : time })
  const setTime = (next: string): void => setEdited({ date, time: next })

  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <DatePicker
          format={MEDIUM_DATE}
          id={id}
          onChange={setDate}
          required={required}
          value={date}
        />
      </div>
      <Input
        aria-label="Time"
        className="w-28 [&::-webkit-calendar-picker-indicator]:hidden"
        disabled={!date}
        onChange={(event) => setTime(event.target.value)}
        required={Boolean(date)}
        type="time"
        value={time}
      />
      <input name={name} type="hidden" value={date && time ? momentOf(date, time, timeZone) : ""} />
    </div>
  )
}

// A saved moment's day and time in a time zone, as the fields take them.
function partsIn(value: string, timeZone: string): { date: string; time: string } {
  const moment = new Date(value)

  if (!value || Number.isNaN(moment.getTime())) {
    return { date: "", time: "" }
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", month: "2-digit", timeZone, year: "numeric" })
      .formatToParts(moment)
      .map((part) => [part.type, part.value])
  )

  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// A day and time read in UTC, or in this browser's own zone, as the moment it is.
function momentOf(date: string, time: string, timeZone: string): string {
  const moment = new Date(timeZone === "UTC" ? `${date}T${time}Z` : `${date}T${time}`)
  return Number.isNaN(moment.getTime()) ? "" : moment.toISOString()
}
