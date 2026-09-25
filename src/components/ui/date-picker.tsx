"use client"

import { CalendarDays } from "lucide-react"
import { lazy, type ReactElement, Suspense, useState } from "react"

import { Input } from "@/components/ui/input"
import { FieldFace } from "@/components/ui/select"
import { type DateFormat, describeDateFormat, formatDateAnswer } from "@/lib/date-format"

const STORED_DATE = /^\d{4}-\d{2}-\d{2}$/
// The app's medium date, as lists show it: Sep 24, 2026.
const MEDIUM_DATE: DateFormat = { month: "short", order: "mdy", separator: " " }

/** What a date picker takes: its stored value, how it reads, and its form name. */
export type DatePickerProps = {
  "aria-describedby"?: string
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
 * A day and a time for a form, posted together as YYYY-MM-DDTHH:mm like a
 * native datetime-local input: the day from the app's calendar, the time typed.
 * A day chosen without a time starts at 09:00.
 *
 * @param props - The starting value, and the form name, id and requirement.
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
  const [date, setDate] = useState(defaultValue.slice(0, 10))
  const [time, setTime] = useState(defaultValue.slice(11, 16))

  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">
        <DatePicker
          format={MEDIUM_DATE}
          id={id}
          onChange={(next: string): void => {
            setDate(next)
            setTime((current: string) => (next && !current ? "09:00" : current))
          }}
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
      <input name={name} type="hidden" value={date && time ? `${date}T${time}` : ""} />
    </div>
  )
}
